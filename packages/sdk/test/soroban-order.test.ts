import { describe, it, expect } from "vitest";
import { parseSorobanOrder } from "../src/soroban/index.js";
import type { SorobanOrderData } from "../src/types/index.js";

// Shared 32-byte buffers used across tests.
const HASHLOCK_BYTES = Buffer.from("a".repeat(64), "hex"); // 32-byte buffer
const PREIMAGE_BYTES = Buffer.from("b".repeat(64), "hex");
const EMPTY_BYTES = Buffer.alloc(0);

/** Minimal valid funded-order payload as scValToNative would return it. */
function fundedRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: BigInt(1),
    sender: "GABC1234",
    beneficiary: "GDEF5678",
    refund_address: "GHIJ9012",
    asset: "CASSET0001",
    amount: BigInt(5_000_000_000),
    safety_deposit: BigInt(10_000_000),
    hashlock: HASHLOCK_BYTES,
    timelock: BigInt(1_800_000_000),
    status: "Funded",
    preimage: EMPTY_BYTES,
    created_at: BigInt(1_700_000_000),
    finalised_at: BigInt(0),
    ...overrides,
  };
}

describe("parseSorobanOrder", () => {
  // ------------------------------------------------------------------
  // null / missing
  // ------------------------------------------------------------------

  it("returns null for null input", () => {
    expect(parseSorobanOrder(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseSorobanOrder(undefined)).toBeNull();
  });

  // ------------------------------------------------------------------
  // Funded order
  // ------------------------------------------------------------------

  it("parses a funded order with all expected fields", () => {
    const result = parseSorobanOrder(fundedRaw()) as SorobanOrderData;

    expect(result).not.toBeNull();
    expect(result.id).toBe(BigInt(1));
    expect(result.sender).toBe("GABC1234");
    expect(result.beneficiary).toBe("GDEF5678");
    expect(result.refundAddress).toBe("GHIJ9012");
    expect(result.asset).toBe("CASSET0001");
    expect(result.amount).toBe(BigInt(5_000_000_000));
    expect(result.safetyDeposit).toBe(BigInt(10_000_000));
    expect(result.hashlock).toBe("0x" + "a".repeat(64));
    expect(result.timelock).toBe(BigInt(1_800_000_000));
    expect(result.status).toBe("Funded");
    expect(result.preimage).toBe("");
    expect(result.createdAt).toBe(BigInt(1_700_000_000));
    expect(result.finalisedAt).toBe(BigInt(0));
  });

  it("normalises numeric id/amount fields supplied as plain numbers", () => {
    const result = parseSorobanOrder(
      fundedRaw({ id: 7, amount: 1_000_000, safety_deposit: 500 })
    ) as SorobanOrderData;

    expect(result.id).toBe(BigInt(7));
    expect(result.amount).toBe(BigInt(1_000_000));
    expect(result.safetyDeposit).toBe(BigInt(500));
  });

  // ------------------------------------------------------------------
  // Claimed order
  // ------------------------------------------------------------------

  it("parses a claimed order with a non-empty preimage", () => {
    const result = parseSorobanOrder(
      fundedRaw({
        status: "Claimed",
        preimage: PREIMAGE_BYTES,
        finalised_at: BigInt(1_700_001_000),
      })
    ) as SorobanOrderData;

    expect(result.status).toBe("Claimed");
    expect(result.preimage).toBe("0x" + "b".repeat(64));
    expect(result.finalisedAt).toBe(BigInt(1_700_001_000));
  });

  // ------------------------------------------------------------------
  // Refunded order
  // ------------------------------------------------------------------

  it("parses a refunded order", () => {
    const result = parseSorobanOrder(
      fundedRaw({
        status: "Refunded",
        finalised_at: BigInt(1_700_002_000),
      })
    ) as SorobanOrderData;

    expect(result.status).toBe("Refunded");
    expect(result.preimage).toBe("");
    expect(result.finalisedAt).toBe(BigInt(1_700_002_000));
  });

  // ------------------------------------------------------------------
  // Malformed payloads
  // ------------------------------------------------------------------

  it("throws on a non-object value (array)", () => {
    expect(() => parseSorobanOrder([])).toThrow("expected an object");
  });

  it("throws on a non-object value (string)", () => {
    expect(() => parseSorobanOrder("not-an-order")).toThrow("expected an object");
  });

  it("throws when a required field is missing (sender)", () => {
    const raw = fundedRaw();
    delete raw["sender"];
    expect(() => parseSorobanOrder(raw)).toThrow('missing required field "sender"');
  });

  it("throws when status is an unknown value", () => {
    expect(() =>
      parseSorobanOrder(fundedRaw({ status: "Pending" }))
    ).toThrow('unknown status value "Pending"');
  });

  it("throws when amount is not a numeric type", () => {
    expect(() =>
      parseSorobanOrder(fundedRaw({ amount: "not-a-number" }))
    ).toThrow('field "amount" is not a numeric type');
  });

  it("throws when sender is not a string", () => {
    expect(() =>
      parseSorobanOrder(fundedRaw({ sender: 12345 }))
    ).toThrow('field "sender" is not a string');
  });

  it("accepts string hex preimage (some SDK versions surface it as string)", () => {
    const result = parseSorobanOrder(
      fundedRaw({ status: "Claimed", preimage: "0x" + "c".repeat(64) })
    ) as SorobanOrderData;

    expect(result.preimage).toBe("0x" + "c".repeat(64));
  });

  it("accepts hashlock supplied as a plain hex string without 0x prefix", () => {
    const result = parseSorobanOrder(
      fundedRaw({ hashlock: "a".repeat(64) })
    ) as SorobanOrderData;

    expect(result.hashlock).toBe("0x" + "a".repeat(64));
  });
});
