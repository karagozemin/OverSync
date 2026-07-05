import { describe, it, expect } from "vitest";
import { runParityCheck } from "./hashlock-parity.js";

describe("hashlock parity check", () => {
  it("generates a fresh secret and confirms all routes pass", () => {
    const proof = runParityCheck();

    expect(proof.preimage).toMatch(/^0x[0-9a-f]{64}$/);
    expect(proof.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(proof.keccak256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(proof.sha256).not.toBe(proof.keccak256);

    expect(proof.evmCrossChainRoute).toBe(true);
    expect(proof.evmNativeRoute).toBe(true);
    expect(proof.sorobanRoute).toBe(true);
    expect(proof.crossChainCompatible).toBe(true);
  });

  it("is deterministic for a given preimage", () => {
    const preimage = "0x" + "ab".repeat(32) as `0x${string}`;
    const a = runParityCheck(preimage);
    const b = runParityCheck(preimage);

    expect(a.sha256).toBe(b.sha256);
    expect(a.keccak256).toBe(b.keccak256);
  });

  it("correctly reports crossChainCompatible when sha256 hashlock works on both chains", () => {
    const proof = runParityCheck();
    expect(proof.crossChainCompatible).toBe(true);
    expect(proof.evmCrossChainRoute).toBe(true);
    expect(proof.sorobanRoute).toBe(true);
  });
});
