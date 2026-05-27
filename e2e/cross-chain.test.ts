import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { generateSecret, hashSecret, verifyPreimage } from "@oversync/sdk/secrets";
import { EvmHtlcSim, SorobanHtlcSim, type HtlcSim } from "./sim.js";

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

  // Shared per-chain scenarios. Driving both simulators through the same
  // assertions is the actual differential check — if either chain
  // diverges, the corresponding case fails for that chain only.
  describe.each<{ label: string; factory: () => HtlcSim }>([
    { label: "EVM HTLCEscrow", factory: () => new EvmHtlcSim() },
    { label: "Soroban oversync-htlc", factory: () => new SorobanHtlcSim() }
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

  describe("cross-chain round-trip", () => {
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
      // This asymmetry is intentional: HTLCEscrow.sol accepts either
      // digest so it can interop with classic EVM tooling; the Soroban
      // contract is sha256-only. Cross-chain swaps therefore MUST use
      // the sha256 digest end-to-end.
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
});
