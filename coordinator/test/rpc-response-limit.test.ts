import { describe, expect, it } from "vitest";
import {
  createBoundedFetch,
  DEFAULT_MAX_RPC_RESPONSE_BYTES,
  parseMaxResponseBytes,
  readBodyWithLimit,
  RPC_RESPONSE_TOO_LARGE,
  RpcResponseTooLargeError
} from "../src/rpc-response-limit.js";

const BODY = '{"jsonrpc":"2.0","id":1,"result":{"sequence":42}}';
const SECRET = "SENSITIVE_PAYLOAD_MARKER";

function asTooLarge(err: unknown): RpcResponseTooLargeError {
  expect(err).toBeInstanceOf(RpcResponseTooLargeError);
  return err as RpcResponseTooLargeError;
}

describe("parseMaxResponseBytes", () => {
  it("falls back to the documented default when unset", () => {
    expect(parseMaxResponseBytes(undefined)).toBe(DEFAULT_MAX_RPC_RESPONSE_BYTES);
  });

  it("accepts a positive integer", () => {
    expect(parseMaxResponseBytes("1024")).toBe(1024);
  });

  it.each(["0", "-1", "1.5", "abc", "", " "])("rejects the unusable value %j", (raw) => {
    expect(() => parseMaxResponseBytes(raw)).toThrow(/RPC_MAX_RESPONSE_BYTES/);
  });
});

describe("readBodyWithLimit", () => {
  it("accepts a body that is exactly at the limit", async () => {
    const limit = Buffer.byteLength(BODY);
    const bytes = await readBodyWithLimit(new Response(BODY).body, limit, "ethereum");
    expect(Buffer.from(bytes).toString("utf8")).toBe(BODY);
  });

  it("rejects a body one byte over the limit", async () => {
    const limit = Buffer.byteLength(BODY) - 1;
    const err = await readBodyWithLimit(new Response(BODY).body, limit, "soroban").catch((e) => e);
    const tooLarge = asTooLarge(err);
    expect(tooLarge.code).toBe(RPC_RESPONSE_TOO_LARGE);
    expect(tooLarge.chain).toBe("soroban");
    expect(tooLarge.limitBytes).toBe(limit);
    expect(tooLarge.observedBytes).toBeGreaterThan(limit);
  });

  it("counts bytes, not characters", async () => {
    const multibyte = '{"m":"ééé"}';
    const limit = multibyte.length;
    expect(Buffer.byteLength(multibyte)).toBeGreaterThan(limit);
    await expect(
      readBodyWithLimit(new Response(multibyte).body, limit, "ethereum")
    ).rejects.toBeInstanceOf(RpcResponseTooLargeError);
  });

  it("never puts the rejected body in the error", async () => {
    const body = JSON.stringify({ secret: SECRET, pad: "x".repeat(64) });
    const err = await readBodyWithLimit(new Response(body).body, 16, "ethereum").catch((e) => e);
    const tooLarge = asTooLarge(err);
    expect(tooLarge.message).not.toContain(SECRET);
    expect(tooLarge.message).toMatch(/exceeded the 16 byte limit/);
  });
});

describe("createBoundedFetch", () => {
  it("passes a body at the limit through unchanged", async () => {
    const bounded = createBoundedFetch(
      "ethereum",
      Buffer.byteLength(BODY),
      async () => new Response(BODY)
    );
    const res = await bounded("https://rpc.example.com", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
  });

  it("rejects on the declared Content-Length before reading the body", async () => {
    const bounded = createBoundedFetch(
      "ethereum",
      32,
      async () => new Response(BODY, { headers: { "content-length": String(Buffer.byteLength(BODY)) } })
    );
    const err = await bounded("https://rpc.example.com").catch((e) => e);
    const tooLarge = asTooLarge(err);
    expect(tooLarge.observedBytes).toBe(Buffer.byteLength(BODY));
  });

  it("rejects a streamed body over the limit without leaking it", async () => {
    const body = JSON.stringify({ secret: SECRET, pad: "y".repeat(256) });
    const bounded = createBoundedFetch("soroban", 64, async () => new Response(body));
    const err = await bounded("https://rpc.example.com").catch((e) => e);
    const tooLarge = asTooLarge(err);
    expect(tooLarge.message).not.toContain(SECRET);
    expect(tooLarge.chain).toBe("soroban");
  });
});
