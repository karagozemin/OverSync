import { describe, expect, it } from "vitest";
import { isSensitiveLogKey, redactLogString, redactLogValue } from "../src/logging/index.js";

describe("log redaction", () => {
  it("redacts nested sensitive fields while preserving safe debugging context", () => {
    const value = {
      publicId: "ord_123",
      status: "src_locked",
      srcChain: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
      secret: "plain-secret",
      nested: {
        privateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        signedXdr: "AAAAAgAAAAA..."
      }
    };

    expect(redactLogValue(value)).toEqual({
      publicId: "ord_123",
      status: "src_locked",
      srcChain: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
      secret: "[REDACTED]",
      nested: {
        privateKey: "[REDACTED]",
        signedXdr: "[REDACTED]"
      }
    });
  });

  it("redacts arrays with mixed safe and sensitive fields", () => {
    const value = [
      { orderId: "42", token: "bearer-token", chain: "stellar" },
      { resolver: "0x2222222222222222222222222222222222222222", failureCode: "timeout" }
    ];

    expect(redactLogValue(value)).toEqual([
      { orderId: "42", token: "[REDACTED]", chain: "stellar" },
      { resolver: "0x2222222222222222222222222222222222222222", failureCode: "timeout" }
    ]);
  });

  it("matches sensitive keys with unknown casing and separators", () => {
    expect(isSensitiveLogKey("Authorization")).toBe(true);
    expect(isSensitiveLogKey("authorization")).toBe(true);
    expect(isSensitiveLogKey("signed_xdr")).toBe(true);
    expect(isSensitiveLogKey("private-key")).toBe(true);
  });

  it("redacts secret-looking substrings from plain strings", () => {
    const preimage = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(redactLogString(`claim failed for ${preimage} with Bearer abc.def`)).toBe(
      "claim failed for [REDACTED] with Bearer [REDACTED]"
    );
  });
});
