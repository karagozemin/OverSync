import { describe, it, expect } from "vitest";
import {
  canTransition,
  getHtlcInvariantChecklist,
  InvalidTransitionError,
  isTerminal,
  nextStatesOf,
  requireTransition
} from "../src/state-machine/index.js";

describe("order state machine", () => {
  it("allows the happy path: announced -> src_locked -> dst_locked -> secret_revealed -> completed", () => {
    requireTransition("announced", "src_locked");
    requireTransition("src_locked", "dst_locked");
    requireTransition("dst_locked", "secret_revealed");
    requireTransition("secret_revealed", "completed");
  });

  it("allows refund from any pre-terminal state", () => {
    expect(canTransition("src_locked", "refunded")).toBe(true);
    expect(canTransition("dst_locked", "refunded")).toBe(true);
    expect(canTransition("secret_revealed", "refunded")).toBe(true);
    expect(canTransition("expired", "refunded")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(() => requireTransition("announced", "completed")).toThrow(InvalidTransitionError);
    expect(canTransition("completed", "announced")).toBe(false);
  });

  it("marks terminal states correctly", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("announced")).toBe(false);
    expect(isTerminal("src_locked")).toBe(false);
  });

  it("nextStatesOf returns a stable list", () => {
    expect(nextStatesOf("announced")).toEqual(["src_locked", "failed", "expired"]);
    expect(nextStatesOf("completed")).toEqual([]);
  });
});

describe("HTLC invariant checklist", () => {
  const checklist = getHtlcInvariantChecklist();

  it("includes all six expected invariants", () => {
    const ids = checklist.map((i) => i.id);
    expect(ids).toContain("same-hashlock");
    expect(ids).toContain("dst-timelock-before-src");
    expect(ids).toContain("beneficiary-claim-before-expiry");
    expect(ids).toContain("refund-after-expiry");
    expect(ids).toContain("coordinator-cannot-steal");
    expect(ids).toContain("resolver-recovery");
    expect(checklist).toHaveLength(6);
  });

  it("each entry has the correct shape", () => {
    for (const inv of checklist) {
      expect(inv.id).toBeTruthy();
      expect(["settlement", "refund", "security", "recovery"]).toContain(inv.category);
      expect(inv.summary).toBeTruthy();
      expect(inv.description).toBeTruthy();
    }
  });

  it("covers settlement invariants", () => {
    const settlement = checklist.filter((i) => i.category === "settlement");
    expect(settlement.map((i) => i.id)).toEqual(
      expect.arrayContaining(["same-hashlock", "beneficiary-claim-before-expiry"])
    );
  });

  it("covers refund invariants", () => {
    expect(checklist.find((i) => i.id === "refund-after-expiry")?.category).toBe("refund");
  });

  it("covers security invariants", () => {
    const security = checklist.filter((i) => i.category === "security");
    expect(security.map((i) => i.id)).toEqual(
      expect.arrayContaining(["dst-timelock-before-src", "coordinator-cannot-steal"])
    );
  });

  it("covers recovery invariants", () => {
    expect(checklist.find((i) => i.id === "resolver-recovery")?.category).toBe("recovery");
  });
});
