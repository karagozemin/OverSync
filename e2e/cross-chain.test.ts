import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { generateSecret, hashSecret, verifyPreimage } from "@oversync/sdk/secrets";
import { EvmHtlcSim, SorobanHtlcSim, type HtlcSim } from "./sim.js";
import { startEvmFixture, type RealEvmHtlcFixture } from "./evm-fixture.js";

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
        hashlock: secret.sha256,
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
        hashlock: secret.sha256,
        timelockSeconds: TIMELOCK_SECONDS
      });
      const sorobanId = soroban.createOrder({
        hashlock: secret.sha256,
        timelockSeconds: TIMELOCK_SECONDS
      });

      evm.claimOrder(evmId, secret.preimage);
      soroban.claimOrder(sorobanId, secret.preimage);

      expect(evm.getOrder(evmId).status).toBe("Claimed");
      expect(soroban.getOrder(sorobanId).status).toBe("Claimed");
      expect(verifyPreimage(secret.preimage, secret.sha256)).toBe("sha256");
    });

    it("a keccak256-only hashlock works on EVM but is rejected by Soroban", () => {
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

      expect(() => evm.claimOrder(evmId, secret.preimage)).not.toThrow();
      expect(() => soroban.claimOrder(sorobanId, secret.preimage)).toThrow(/InvalidPreimage/);
    });
  });

  // ── Real EVM execution via Anvil + deployed HTLCEscrow ──────────────────
describe("real EVM HTLCEscrow (Anvil)", () => {
    let fixture: RealEvmHtlcFixture | undefined;

    beforeAll(async () => {
      fixture = await startEvmFixture();
    }, 60_000);

   afterAll(async () => {
  if (fixture) {
    await fixture.stop();
  }
});
    it("deploys and accepts a valid sha256 preimage from @oversync/sdk — order becomes Claimed", async () => {
      const secret = generateSecret();

      const orderId = await fixture.createOrder(secret.sha256, TIMELOCK_SECONDS);
      expect(await fixture.getOrderStatus(orderId)).toBe("Funded");

      await fixture.claimOrder(orderId, secret.preimage);
      expect(await fixture.getOrderStatus(orderId)).toBe("Claimed");

      expect(verifyPreimage(secret.preimage, secret.sha256)).toBe("sha256");
    }, 30_000);

    it("rejects a wrong preimage on the REAL EVM contract — InvalidPreimage", async () => {
      const secret = generateSecret();
      const wrong = generateSecret();

      const orderId = await fixture.createOrder(secret.sha256, TIMELOCK_SECONDS);

      const errorName = await fixture.claimOrderExpectRevert(orderId, wrong.preimage);
      expect(errorName).toMatch(/InvalidPreimage/);

      expect(await fixture.getOrderStatus(orderId)).toBe("Funded");
    }, 30_000);

    it("real EVM hashlock and Soroban simulator agree on the same sha256 secret", async () => {
      const secret = generateSecret();
      const soroban = new SorobanHtlcSim();

      const evmId = await fixture.createOrder(secret.sha256, TIMELOCK_SECONDS);
      const sorobanId = soroban.createOrder({
        hashlock: secret.sha256,
        timelockSeconds: TIMELOCK_SECONDS
      });

      await fixture.claimOrder(evmId, secret.preimage);
      soroban.claimOrder(sorobanId, secret.preimage);

      expect(await fixture.getOrderStatus(evmId)).toBe("Claimed");
      expect(soroban.getOrder(sorobanId).status).toBe("Claimed");
    }, 30_000);
  });
});
