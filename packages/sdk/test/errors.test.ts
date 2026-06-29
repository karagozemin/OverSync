import { describe, it, expect } from "vitest";
import { OverSyncError, OverSyncErrorCode, normalizeError } from "../src/errors/index.js";
import { EthereumHTLCClient } from "../src/ethereum/index.js";
import type { Address, PublicClient } from "viem";

describe("SDK Error Normalization", () => {
  it("normalizes wallet rejections", () => {
    const err = new Error("User rejected the request");
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(OverSyncError);
    expect(normalized.code).toBe(OverSyncErrorCode.WALLET_REJECTED);
  });

  it("normalizes contract reverts", () => {
    const err = new Error("execution reverted: balance too low");
    const normalized = normalizeError(err);
    expect(normalized.code).toBe(OverSyncErrorCode.CONTRACT_REVERT);
  });

  it("normalizes RPC failures", () => {
    const err = new Error("Network timeout");
    const normalized = normalizeError(err);
    expect(normalized.code).toBe(OverSyncErrorCode.RPC_FAILURE);
  });

  it("returns OverSyncError as is", () => {
    const err = new OverSyncError("Already normalized", OverSyncErrorCode.VALIDATION_FAILED);
    const normalized = normalizeError(err);
    expect(normalized).toBe(err);
  });

  it("throws VALIDATION_FAILED when wallet is missing in EthereumHTLCClient", async () => {
    const client = new EthereumHTLCClient({
      address: "0x0000000000000000000000000000000000000000" as Address,
      publicClient: {} as PublicClient,
    });

    await expect(client.claimOrder(1n, "0x")).rejects.toThrowError(OverSyncError);
    
    try {
      await client.claimOrder(1n, "0x");
    } catch (e) {
      expect(e).toBeInstanceOf(OverSyncError);
      if (e instanceof OverSyncError) {
        expect(e.code).toBe(OverSyncErrorCode.VALIDATION_FAILED);
      }
    }
  });
});
