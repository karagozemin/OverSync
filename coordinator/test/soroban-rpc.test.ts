import { describe, expect, it } from "vitest";
import { nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { createSorobanRpcClient } from "../src/soroban-rpc.js";
import { RpcResponseTooLargeError } from "../src/rpc-response-limit.js";

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const SCVAL = nativeToScVal(7, { type: "u64" }).toXDR("base64");
const RPC_URL = "https://soroban.example.com";

function envelope(result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result });
}

function fakeFetch(body: string) {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined
    });
    return new Response(body);
  };
  return { fetchImpl, calls };
}

function eventEnvelope(): string {
  return envelope({
    latestLedger: 99,
    cursor: "cursor-2",
    events: [
      {
        id: "0000000099-0001",
        type: "contract",
        ledger: 99,
        ledgerClosedAt: "2026-01-01T00:00:00Z",
        pagingToken: "0000000099-0001",
        inSuccessfulContractCall: true,
        txHash: "tx-1",
        contractId: CONTRACT_ID,
        topic: [SCVAL],
        value: SCVAL
      }
    ]
  });
}

describe("createSorobanRpcClient", () => {
  it("accepts a response that is exactly at the limit", async () => {
    const body = envelope({ id: "ledger-1", sequence: 42, protocolVersion: "22" });
    const { fetchImpl } = fakeFetch(body);
    const client = createSorobanRpcClient(RPC_URL, {
      maxResponseBytes: Buffer.byteLength(body),
      fetchImpl
    });

    await expect(client.getLatestLedger()).resolves.toMatchObject({ sequence: 42 });
  });

  it("rejects a response one byte over the limit", async () => {
    const body = envelope({ id: "ledger-1", sequence: 42, protocolVersion: "22" });
    const { fetchImpl } = fakeFetch(body);
    const client = createSorobanRpcClient(RPC_URL, {
      maxResponseBytes: Buffer.byteLength(body) - 1,
      fetchImpl
    });

    await expect(client.getLatestLedger()).rejects.toBeInstanceOf(RpcResponseTooLargeError);
  });

  it("sends getEvents pagination and decodes the events", async () => {
    const { fetchImpl, calls } = fakeFetch(eventEnvelope());
    const client = createSorobanRpcClient(RPC_URL, { fetchImpl });

    const events = await client.getEvents({
      filters: [{ type: "contract", contractIds: [CONTRACT_ID] }],
      startLedger: 90,
      limit: 100
    });

    expect(events.cursor).toBe("cursor-2");
    expect(events.events[0]?.txHash).toBe("tx-1");
    const sent = JSON.parse(calls[0]?.body ?? "{}");
    expect(sent.method).toBe("getEvents");
    expect(sent.params.startLedger).toBe(90);
    expect(sent.params.pagination).toEqual({ limit: 100 });
  });

  it("surfaces a JSON-RPC error envelope", async () => {
    const { fetchImpl } = fakeFetch(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "invalid request" } })
    );
    const client = createSorobanRpcClient(RPC_URL, { fetchImpl });

    await expect(client.getLatestLedger()).rejects.toThrow(/-32600.*invalid request/);
  });

  it("refuses a plain-http endpoint unless explicitly allowed", () => {
    expect(() => createSorobanRpcClient("http://localhost:8000")).toThrow(/https/);
    expect(() =>
      createSorobanRpcClient("http://localhost:8000", { allowHttp: true, fetchImpl: fakeFetch("{}").fetchImpl })
    ).not.toThrow();
  });
});
