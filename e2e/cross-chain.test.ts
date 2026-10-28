import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { generateSecret, hashSecret, hashOrderPreimage, verifyPreimage } from "@oversync/sdk/secrets";
import {
  EvmHtlcSim,
  SorobanHtlcSim,
  assertEscrowReleasedTogether,
  OneSidedReleaseError,
  DEFAULT_ESCROW_AMOUNT,
  type HtlcSim,
  type CrossChainLeg
} from "./sim.js";
import {
  startEvmFixture,
  HARDHAT_TEST_KEYS,
  ESCROW_AMOUNT,
  type RealEvmHtlcFixture
} from "./evm-fixture.js";

const TIMELOCK_SECONDS = 600;
const PAST_TIMELOCK = TIMELOCK_SECONDS + 1;

// Independent oracle: Node's built-in crypto module. If the SDK's sha256
// agrees with this, it also agrees with every other standards-compliant
// sha256 implementation — Solidity's `sha256(...)` precompile and
// Soroban's `env.crypto().sha256(...)` included.
function canonicalSha256(hex: `0x${string}`): `0x${string}` {
  const buf = Buffer.from(hex.slice(2), "hex");
  return `0x${createHash("sha256").update(buf).digest("hex")}` as `0x${string}`;
}

describe("cross-chain HTLC differential harness", () => {
  describe("hash primitive parity", () => {
    it("SDK hashSecret().sha256 matches Node's canonical sha256", () => {
      const s = generateSecret();
      expect(canonicalSha256(s.preimage)).toBe(s.sha256);
    });

    it("hashSecret is deterministic for a given preimage", () => {
      const s = generateSecret();
      expect(hashSecret(s.preimage).sha256).toBe(s.sha256);
      expect(hashSecret(s.preimage).keccak256).toBe(s.keccak256);
    });
  });

  // ── Simulator differential (unchanged from Wave 5) ──────────────────────
  describe.each<{ label: string; factory: () => HtlcSim }>([
    { label: "EVM HTLCEscrow (sim)", factory: () => new EvmHtlcSim() },
    { label: "Soroban oversync-htlc (sim)", factory: () => new SorobanHtlcSim() }
  ])("$label", ({ factory }) => {
    let chain: HtlcSim;
    let secret: ReturnType<typeof generateSecret>;
    let orderId: bigint;

    beforeEach(() => {
      chain = factory();
      secret = generateSecret();
      orderId = chain.createOrder({
        hashlock: hashOrderPreimage(1n, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS
      });
    });

    it("accepts the valid preimage and marks the order Claimed", () => {
      expect(() => chain.claimOrder(orderId, secret.preimage)).not.toThrow();
      expect(chain.getOrder(orderId).status).toBe("Claimed");
    });

    it("rejects an unrelated preimage with InvalidPreimage", () => {
      const other = generateSecret();
      expect(() => chain.claimOrder(orderId, other.preimage)).toThrow(/InvalidPreimage/);
      expect(chain.getOrder(orderId).status).toBe("Funded");
    });

    it("rejects refund while the order is still inside the timelock", () => {
      expect(() => chain.refundOrder(orderId)).toThrow(/NotExpired/);
      expect(chain.getOrder(orderId).status).toBe("Funded");
    });

    it("permits refund once the timelock has expired", () => {
      chain.advanceTime(PAST_TIMELOCK);
      expect(() => chain.refundOrder(orderId)).not.toThrow();
      expect(chain.getOrder(orderId).status).toBe("Refunded");
    });

    it("rejects claim once the timelock has expired", () => {
      chain.advanceTime(PAST_TIMELOCK);
      expect(() => chain.claimOrder(orderId, secret.preimage)).toThrow(/Expired/);
    });

    it("rejects a second claim against an already-claimed order", () => {
      chain.claimOrder(orderId, secret.preimage);
      expect(() => chain.claimOrder(orderId, secret.preimage)).toThrow(/OrderNotClaimable/);
    });
  });

  // ── Simulator cross-chain round-trip (unchanged from Wave 5) ────────────
  describe("cross-chain round-trip (simulators)", () => {
    it("one sha256 hashlock unlocks BOTH chains with the same preimage", () => {
      const secret = generateSecret();
      const evm = new EvmHtlcSim();
      const soroban = new SorobanHtlcSim();

      const evmId = evm.createOrder({
        hashlock: hashOrderPreimage(1n, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS
      });
      const sorobanId = soroban.createOrder({
        hashlock: hashOrderPreimage(1n, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS
      });

      evm.claimOrder(evmId, secret.preimage);
      soroban.claimOrder(sorobanId, secret.preimage);

      expect(evm.getOrder(evmId).status).toBe("Claimed");
      expect(soroban.getOrder(sorobanId).status).toBe("Claimed");
      expect(verifyPreimage(secret.preimage, secret.sha256)).toBe("sha256");
    });

    it("rejects an unbound keccak256 hashlock on both chains", () => {
      const secret = generateSecret();
      const evm = new EvmHtlcSim();
      const soroban = new SorobanHtlcSim();

      const evmId = evm.createOrder({
        hashlock: secret.keccak256,
        timelockSeconds: TIMELOCK_SECONDS
      });
      const sorobanId = soroban.createOrder({
        hashlock: secret.keccak256,
        timelockSeconds: TIMELOCK_SECONDS
      });

      expect(() => evm.claimOrder(evmId, secret.preimage)).toThrow(/InvalidPreimage/);
      expect(() => soroban.claimOrder(sorobanId, secret.preimage)).toThrow(/InvalidPreimage/);
    });
  });

  // ── Two-sided escrow release invariant (issue #281) ───────────────────────
  //
  // A cross-chain swap is only safe when BOTH legs finalise together. These
  // tests track the escrow balance on the EVM fixture and the Stellar (Soroban)
  // fixture and compare them at the end of claim and refund, so a single-sided
  // fill — a stuck bridge — fails loudly instead of being reported as success.
  describe("two-sided escrow release", () => {
    const AMOUNT = DEFAULT_ESCROW_AMOUNT;

    function fundedPair(secret: ReturnType<typeof generateSecret>) {
      const evm = new EvmHtlcSim();
      const stellar = new SorobanHtlcSim();
      const evmNextId = evm.nextOrderId();
      const evmId = evm.createOrder({
        hashlock: hashOrderPreimage(evmNextId, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS,
        amount: AMOUNT,
        maker: "evm-maker",
        recipient: "evm-recipient"
      });
      const stellarNextId = stellar.nextOrderId();
      const stellarId = stellar.createOrder({
        hashlock: hashOrderPreimage(stellarNextId, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS,
        amount: AMOUNT,
        maker: "stellar-maker",
        recipient: "stellar-recipient"
      });
      const legs: [CrossChainLeg, CrossChainLeg] = [
        { side: "evm", sim: evm, orderId: evmId },
        { side: "stellar", sim: stellar, orderId: stellarId }
      ];
      return { evm, stellar, evmId, stellarId, legs };
    }

    it("locks escrow on both sides when the pair is funded", () => {
      const { evm, stellar, evmId, stellarId } = fundedPair(generateSecret());
      expect(evm.getEscrowBalanceFor(evmId)).toBe(AMOUNT);
      expect(stellar.getEscrowBalanceFor(stellarId)).toBe(AMOUNT);
    });

    it("happy-path claim releases escrow on BOTH sides to the recipient", () => {
      const secret = generateSecret();
      const { evm, stellar, evmId, stellarId, legs } = fundedPair(secret);

      const evmRecipientBefore = evm.getBalance("evm-recipient");
      const stellarRecipientBefore = stellar.getBalance("stellar-recipient");

      evm.claimOrder(evmId, secret.preimage);
      stellar.claimOrder(stellarId, secret.preimage);

      // Core invariant: both escrow balances compared at the end of the claim.
      expect(() => assertEscrowReleasedTogether(legs, "claim")).not.toThrow();

      // Funds released to the expected recipient on each side.
      expect(evm.getBalance("evm-recipient") - evmRecipientBefore).toBe(AMOUNT);
      expect(stellar.getBalance("stellar-recipient") - stellarRecipientBefore).toBe(AMOUNT);
      expect(evm.getEscrowBalanceFor(evmId)).toBe(0n);
      expect(stellar.getEscrowBalanceFor(stellarId)).toBe(0n);
    });

    it("happy-path refund returns escrow on BOTH sides to the maker", () => {
      const secret = generateSecret();
      const { evm, stellar, evmId, stellarId, legs } = fundedPair(secret);

      const evmMakerBefore = evm.getBalance("evm-maker");
      const stellarMakerBefore = stellar.getBalance("stellar-maker");

      evm.advanceTime(PAST_TIMELOCK);
      stellar.advanceTime(PAST_TIMELOCK);
      evm.refundOrder(evmId);
      stellar.refundOrder(stellarId);

      expect(() => assertEscrowReleasedTogether(legs, "refund")).not.toThrow();

      // Funds back with the maker on each side.
      expect(evm.getBalance("evm-maker") - evmMakerBefore).toBe(AMOUNT);
      expect(stellar.getBalance("stellar-maker") - stellarMakerBefore).toBe(AMOUNT);
      expect(evm.getEscrowBalanceFor(evmId)).toBe(0n);
      expect(stellar.getEscrowBalanceFor(stellarId)).toBe(0n);
    });

    it("a claim that releases only the EVM side FAILS and names Stellar as still locked", () => {
      const secret = generateSecret();
      const { evm, stellar, evmId, stellarId, legs } = fundedPair(secret);

      evm.claimOrder(evmId, secret.preimage); // single-sided fill

      let thrown: unknown;
      try {
        assertEscrowReleasedTogether(legs, "claim");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(OneSidedReleaseError);
      expect((thrown as OneSidedReleaseError).lockedSide).toBe("stellar");
      // The stuck side still holds the escrow.
      expect(stellar.getEscrowBalanceFor(stellarId)).toBe(AMOUNT);
      expect(stellar.getOrder(stellarId).status).toBe("Funded");
    });

    it("a refund that releases only the Stellar side FAILS and names EVM as still locked", () => {
      const secret = generateSecret();
      const { evm, stellar, evmId, stellarId, legs } = fundedPair(secret);

      evm.advanceTime(PAST_TIMELOCK);
      stellar.advanceTime(PAST_TIMELOCK);
      stellar.refundOrder(stellarId); // single-sided refund

      let thrown: unknown;
      try {
        assertEscrowReleasedTogether(legs, "refund");
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(OneSidedReleaseError);
      expect((thrown as OneSidedReleaseError).lockedSide).toBe("evm");
      expect(evm.getEscrowBalanceFor(evmId)).toBe(AMOUNT);
      expect(evm.getOrder(evmId).status).toBe("Funded");
    });

    it("uses only canonical Hardhat test keys — never a mainnet key", () => {
      // The two-sided simulation above holds no key material at all; the real
      // EVM fixture uses the publicly documented Hardhat/Anvil dev accounts,
      // which control no real funds.
      expect(HARDHAT_TEST_KEYS.deployer).toBe(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
      );
      expect(HARDHAT_TEST_KEYS.beneficiary).toBe(
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
      );
    });
  });

  // ── Real EVM execution via Anvil + deployed HTLCEscrow ──────────────────
describe("real EVM HTLCEscrow (Anvil)", () => {
    let fixture: RealEvmHtlcFixture;

    beforeAll(async () => {
      fixture = await startEvmFixture();
    }, 60_000);

   afterAll(async () => {
    await fixture.stop();
});
    it("deploys and accepts a valid sha256 preimage from @oversync/sdk — order becomes Claimed", async () => {
      const secret = generateSecret();

      const orderId = await fixture.nextOrderId();
      await fixture.createOrder(hashOrderPreimage(orderId, secret.preimage), TIMELOCK_SECONDS);
      expect(await fixture.getOrderStatus(orderId)).toBe("Funded");

      // The real EVM fixture tracks escrow: funding locks ESCROW_AMOUNT in the contract.
      const escrowWhileFunded = await fixture.getEscrowBalance();

      await fixture.claimOrder(orderId, secret.preimage);
      expect(await fixture.getOrderStatus(orderId)).toBe("Claimed");

      // Claiming released the escrow out of the contract to the beneficiary.
      expect(escrowWhileFunded - (await fixture.getEscrowBalance())).toBe(ESCROW_AMOUNT);

      expect(verifyPreimage(secret.preimage, secret.sha256)).toBe("sha256");
    }, 30_000);

    it("rejects a wrong preimage on the REAL EVM contract — InvalidPreimage", async () => {
      const secret = generateSecret();
      const wrong = generateSecret();

      const orderId = await fixture.nextOrderId();
      await fixture.createOrder(hashOrderPreimage(orderId, secret.preimage), TIMELOCK_SECONDS);

      const errorName = await fixture.claimOrderExpectRevert(orderId, wrong.preimage);
      expect(errorName).toMatch(/InvalidPreimage/);

      expect(await fixture.getOrderStatus(orderId)).toBe("Funded");
    }, 30_000);

    it("real EVM hashlock and Soroban simulator agree on the same sha256 secret", async () => {
      const secret = generateSecret();
      const soroban = new SorobanHtlcSim();

      const evmId = await fixture.nextOrderId();
      await fixture.createOrder(hashOrderPreimage(evmId, secret.preimage), TIMELOCK_SECONDS);
      const sorobanId = soroban.createOrder({
        hashlock: hashOrderPreimage(1n, secret.preimage),
        timelockSeconds: TIMELOCK_SECONDS
      });

      await fixture.claimOrder(evmId, secret.preimage);
      soroban.claimOrder(sorobanId, secret.preimage);

      expect(await fixture.getOrderStatus(evmId)).toBe("Claimed");
      expect(soroban.getOrder(sorobanId).status).toBe("Claimed");
    }, 30_000);
  });
});
