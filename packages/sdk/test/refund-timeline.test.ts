import { describe, it, expect } from "vitest";
import { simulateRefundTimeline, type RefundTimelineInput } from "../src/state-machine/refund-timeline.js";

const NOW = 1_700_000_000;

function make(overrides: Partial<RefundTimelineInput>): RefundTimelineInput {
  return {
    direction: "eth_to_xlm",
    sourceTimelockUnixSeconds: NOW + 3600,
    destinationTimelockUnixSeconds: NOW + 1800,
    sourceLockObserved: true,
    destinationLockObserved: true,
    nowUnixSeconds: NOW,
    ...overrides,
  };
}

describe("simulateRefundTimeline", () => {
  describe("waiting state", () => {
    it("returns waiting when destination lock not observed and source timelock not expired", () => {
      const result = simulateRefundTimeline(make({ destinationLockObserved: false }));
      expect(result.state).toBe("waiting");
      expect(result.stateLabel).toBe("Waiting");
      expect(result.isReadonly).toBe(true);
    });

    it("returns waiting when source timelock not expired and destination lock not observed", () => {
      const result = simulateRefundTimeline(make({
        sourceLockObserved: true,
        destinationLockObserved: false,
      }));
      expect(result.state).toBe("waiting");
    });

    it("returns waiting when within timelocks but no destination lock", () => {
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: NOW + 3600,
        destinationTimelockUnixSeconds: NOW + 3600,
        destinationLockObserved: false,
      }));
      expect(result.state).toBe("waiting");
    });
  });

  describe("claimable state", () => {
    it("returns claimable when destination is locked and destination timelock not expired", () => {
      const result = simulateRefundTimeline(make({
        destinationLockObserved: true,
        destinationTimelockUnixSeconds: NOW + 1800,
      }));
      expect(result.state).toBe("claimable");
      expect(result.stateLabel).toBe("Claimable");
      expect(result.claimableBy).toMatch(/claim/);
    });

    it("returns claimable for xlm_to_eth direction", () => {
      const result = simulateRefundTimeline(make({
        direction: "xlm_to_eth",
        destinationLockObserved: true,
        destinationTimelockUnixSeconds: NOW + 1800,
      }));
      expect(result.state).toBe("claimable");
      expect(result.claimableBy).toMatch(/ETH/);
    });

    it("returns claimable for eth_to_xlm direction", () => {
      const result = simulateRefundTimeline(make({
        direction: "eth_to_xlm",
        destinationLockObserved: true,
        destinationTimelockUnixSeconds: NOW + 1800,
      }));
      expect(result.state).toBe("claimable");
      expect(result.claimableBy).toMatch(/XLM/);
    });
  });

  describe("refundable state", () => {
    it("returns refundable when source timelock has expired", () => {
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: NOW - 1,
      }));
      expect(result.state).toBe("refundable");
      expect(result.stateLabel).toBe("Refundable");
      expect(result.refundableBy).toMatch(/refund/);
    });

    it("returns refundable when source timelock has expired even if destination is locked", () => {
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: NOW - 1,
        destinationLockObserved: true,
        destinationTimelockUnixSeconds: NOW + 1800,
      }));
      expect(result.state).toBe("refundable");
    });

    it("returns refundable for xlm_to_eth when source timelock expired", () => {
      const result = simulateRefundTimeline(make({
        direction: "xlm_to_eth",
        sourceTimelockUnixSeconds: NOW - 1,
      }));
      expect(result.state).toBe("refundable");
      expect(result.refundableBy).toMatch(/XLM/);
    });

    it("returns refundable for eth_to_xlm when source timelock expired", () => {
      const result = simulateRefundTimeline(make({
        direction: "eth_to_xlm",
        sourceTimelockUnixSeconds: NOW - 1,
      }));
      expect(result.state).toBe("refundable");
      expect(result.refundableBy).toMatch(/ETH/);
    });

    it("returns refundable when source timelock is exactly now", () => {
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: NOW,
      }));
      expect(result.state).toBe("refundable");
    });
  });

  describe("timestamps and metadata", () => {
    it("returns correct timelock expiry dates", () => {
      const srcTs = NOW + 3600;
      const dstTs = NOW + 1800;
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: srcTs,
        destinationTimelockUnixSeconds: dstTs,
      }));
      expect(result.sourceTimelockExpiry.getTime()).toBe(srcTs * 1000);
      expect(result.destinationTimelockExpiry.getTime()).toBe(dstTs * 1000);
    });

    it("uses real clock when nowUnixSeconds is not provided", () => {
      const future = Math.floor(Date.now() / 1000) + 7200;
      const result = simulateRefundTimeline(make({
        sourceTimelockUnixSeconds: future,
        destinationLockObserved: true,
        destinationTimelockUnixSeconds: future + 3600,
        nowUnixSeconds: undefined,
      }));
      expect(result.state).toBe("claimable");
    });

    it("always returns isReadonly true", () => {
      const result = simulateRefundTimeline(make());
      expect(result.isReadonly).toBe(true);
    });
  });

  describe("eth_to_xlm specific descriptions", () => {
    it("waiting description mentions destination lock", () => {
      const result = simulateRefundTimeline(make({ destinationLockObserved: false }));
      expect(result.stateDescription).toMatch(/lock/);
    });

    it("claimable description mentions destination chain", () => {
      const result = simulateRefundTimeline(make({ destinationLockObserved: true }));
      expect(result.stateDescription).toMatch(/Stellar/);
    });

    it("refundable description mentions source chain", () => {
      const result = simulateRefundTimeline(make({ sourceTimelockUnixSeconds: NOW - 1 }));
      expect(result.stateDescription).toMatch(/Ethereum/);
    });
  });

  describe("xlm_to_eth specific descriptions", () => {
    it("claimable description mentions Ethereum for xlm_to_eth", () => {
      const result = simulateRefundTimeline(make({
        direction: "xlm_to_eth",
        destinationLockObserved: true,
      }));
      expect(result.stateDescription).toMatch(/Ethereum/);
    });

    it("refundable description mentions Stellar for xlm_to_eth", () => {
      const result = simulateRefundTimeline(make({
        direction: "xlm_to_eth",
        sourceTimelockUnixSeconds: NOW - 1,
      }));
      expect(result.stateDescription).toMatch(/Stellar/);
    });
  });
});
