import { describe, it, expect } from "vitest";
import { simulateRefund } from "../src/state-machine/refund-simulator.js";
import type { RefundSimulation, SimulatedPhase } from "../src/state-machine/refund-simulator.js";

describe("refund simulator", () => {
  const FAR_FUTURE = 4_000_000_000;
  const FAR_PAST = 1_000_000_000;
  const NOW = 2_000_000_000;

  // ── Phase: claimable (both timelocks active) ────────────────────────────

  it("returns claimable when both timelocks are in the future", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.phase).toBe("claimable");
    expect(result.src.expired).toBe(false);
    expect(result.dst.expired).toBe(false);
  });

  // ── Phase: waiting (one expired, one active) ────────────────────────────

  it("returns waiting when only source timelock has expired", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_PAST,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.phase).toBe("waiting");
    expect(result.src.expired).toBe(true);
    expect(result.dst.expired).toBe(false);
    expect(result.summary).toContain("One timelock has expired");
  });

  it("returns waiting when only destination timelock has expired", () => {
    const result = simulateRefund({
      direction: "xlm_to_eth",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_PAST,
      nowUnixSeconds: NOW,
    });
    expect(result.phase).toBe("waiting");
    expect(result.src.expired).toBe(false);
    expect(result.dst.expired).toBe(true);
    expect(result.summary).toContain("One timelock has expired");
  });

  // ── Phase: refundable (both expired) ────────────────────────────────────

  it("returns refundable when both timelocks have expired", () => {
    const result = simulateRefund({
      direction: "xlm_to_eth",
      srcTimelockUnixSeconds: FAR_PAST,
      dstTimelockUnixSeconds: FAR_PAST,
      nowUnixSeconds: NOW,
    });
    expect(result.phase).toBe("refundable");
    expect(result.src.expired).toBe(true);
    expect(result.dst.expired).toBe(true);
    expect(result.summary).toContain("Both timelocks have expired");
  });

  // ── Direction handling ─────────────────────────────────────────────────

  it("handles eth_to_xlm direction correctly", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.src.chain).toBe("Ethereum");
    expect(result.dst.chain).toBe("Stellar");
    expect(result.summary).toContain("ETH → XLM");
  });

  it("handles xlm_to_eth direction correctly", () => {
    const result = simulateRefund({
      direction: "xlm_to_eth",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.src.chain).toBe("Stellar");
    expect(result.dst.chain).toBe("Ethereum");
    expect(result.summary).toContain("XLM → ETH");
  });

  it("uses current time when nowUnixSeconds is not provided", () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: past,
      dstTimelockUnixSeconds: past,
    });
    expect(result.phase).toBe("refundable");
  });

  // ── Per-leg metadata ───────────────────────────────────────────────────

  it("reports who can claim and refund per leg for eth_to_xlm", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.src.claimParty).toBe("Recipient (Stellar address)");
    expect(result.src.refundParty).toBe("Sender (refundAddress)");
    expect(result.dst.claimParty).toBe("Recipient (you)");
    expect(result.dst.refundParty).toBe("Resolver");
  });

  it("reports who can claim and refund per leg for xlm_to_eth", () => {
    const result = simulateRefund({
      direction: "xlm_to_eth",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.src.claimParty).toBe("Recipient (Ethereum address)");
    expect(result.src.refundParty).toBe("Sender (refundAddress)");
    expect(result.dst.claimParty).toBe("Recipient (you)");
    expect(result.dst.refundParty).toBe("Resolver");
  });

  // ── Read-only marker ───────────────────────────────────────────────────

  it("returns readonly marker", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.readonly).toBe(true);
  });

  it("generates summary that mentions simulation", () => {
    const result = simulateRefund({
      direction: "eth_to_xlm",
      srcTimelockUnixSeconds: FAR_FUTURE,
      dstTimelockUnixSeconds: FAR_FUTURE,
      nowUnixSeconds: NOW,
    });
    expect(result.summary).toMatch(/read-only\s*simulation/i);
  });
});
