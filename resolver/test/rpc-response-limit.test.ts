import { describe, expect, it } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";
import {
  createBoundedFetch,
  DEFAULT_MAX_RPC_RESPONSE_BYTES,
  parseMaxResponseBytes,
  readBodyWithLimit,
  RpcResponseTooLargeError
} from "../src/rpc-response-limit.js";
import { createSorobanRpcClient } from "../src/soroban-rpc.js";

const BODY = '{"jsonrpc":"2.0","id":1,"result":{"sequence":42}}';

describe("resolver rpc-response-limit", () => {
  it("defaults the byte limit when the env var is unset", () => {
    expect(parseMaxResponseBytes(undefined)).toBe(DEFAULT_MAX_RPC_RESPONSE_BYTES);
    expect(() => parseMaxResponseBytes("0")).toThrow(/RPC_MAX_RESPONSE_BYTES/);
  });

  it("accepts a body exactly at the limit", async () => {
    const limit = Buffer.byteLength(BODY);
    const bytes = await readBodyWithLimit(new Response(BODY).body, limit, "ethereum");
    expect(Buffer.from(bytes).toString("utf8")).toBe(BODY);
  });

  it("rejects a body one byte over the limit", async () => {
    const limit = Buffer.byteLength(BODY) - 1;
    await expect(
      readBodyWithLimit(new Response(BODY).body, limit, "ethereum")
    ).rejects.toBeInstanceOf(RpcResponseTooLargeError);
  });

  it("rejects an oversized response through the bounded fetch", async () => {
    const bounded = createBoundedFetch("ethereum", 32, async () => new Response(BODY));
    await expect(bounded("https://rpc.example.com")).rejects.toBeInstanceOf(
      RpcResponseTooLargeError
    );
  });

  it("bounds Soroban listener responses before parsing", async () => {
    const scval = nativeToScVal(7, { type: "u64" }).toXDR("base64");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { latestLedger: 5, cursor: "c", events: [{ topic: [scval], value: scval }] }
    });
    const client = createSorobanRpcClient("https://soroban.example.com", {
      maxResponseBytes: Buffer.byteLength(body) - 1,
      fetchImpl: async () => new Response(body)
    });
    await expect(client.getEvents({ filters: [] })).rejects.toBeInstanceOf(
      RpcResponseTooLargeError
    );
  });
});
