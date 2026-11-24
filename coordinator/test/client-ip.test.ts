import { describe, it, expect } from "vitest";
import {
  normalizeIp,
  parseTrustedProxySetting,
  resolveClientIp
} from "../src/server/client-ip.js";

describe("parseTrustedProxySetting", () => {
  it("defaults to zero hops so forwarding headers stay ignored", () => {
    expect(parseTrustedProxySetting(undefined)).toBe(0);
    expect(parseTrustedProxySetting(null)).toBe(0);
    expect(parseTrustedProxySetting("")).toBe(0);
    expect(parseTrustedProxySetting("false")).toBe(0);
    expect(parseTrustedProxySetting("0")).toBe(0);
    expect(parseTrustedProxySetting("off")).toBe(0);
  });

  it("treats truthy flags as a single trusted hop", () => {
    expect(parseTrustedProxySetting("true")).toBe(1);
    expect(parseTrustedProxySetting("YES")).toBe(1);
    expect(parseTrustedProxySetting("on")).toBe(1);
  });

  it("accepts an explicit hop count", () => {
    expect(parseTrustedProxySetting("2")).toBe(2);
    expect(parseTrustedProxySetting("3")).toBe(3);
  });

  it("rejects non-integer or negative values", () => {
    expect(parseTrustedProxySetting("-1")).toBe(0);
    expect(parseTrustedProxySetting("1.5")).toBe(0);
    expect(parseTrustedProxySetting("proxy")).toBe(0);
  });
});

describe("normalizeIp", () => {
  it("strips IPv4-mapped IPv6 prefixes and ports", () => {
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("203.0.113.9:443")).toBe("203.0.113.9");
  });

  it("strips brackets and quoted IPv6 forms", () => {
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeIp('"[2001:db8::1]:4711"')).toBe("2001:db8::1");
  });
});

describe("resolveClientIp", () => {
  const peer = (remoteAddress: string, headers: Record<string, string> = {}) => ({
    headers,
    socket: { remoteAddress }
  });

  it("ignores Forwarded and X-Forwarded-For by default (spoofing)", () => {
    expect(
      resolveClientIp(
        peer("10.0.0.5", {
          "x-forwarded-for": "198.51.100.7, 203.0.113.1",
          forwarded: "for=198.51.100.7"
        })
      )
    ).toBe("10.0.0.5");
  });

  it("honours X-Forwarded-For only with an explicit trusted-proxy hop count", () => {
    expect(
      resolveClientIp(
        peer("10.0.0.5", { "x-forwarded-for": "198.51.100.7, 203.0.113.1" }),
        { trustedProxyHops: 1 }
      )
    ).toBe("203.0.113.1");

    expect(
      resolveClientIp(
        peer("10.0.0.5", { "x-forwarded-for": "198.51.100.7, 203.0.113.1, 10.0.0.5" }),
        { trustedProxyHops: 2 }
      )
    ).toBe("203.0.113.1");
  });

  it("honours the Forwarded header when trusted-proxy hops are configured", () => {
    expect(
      resolveClientIp(
        peer("10.0.0.5", {
          forwarded: 'for=198.51.100.7;proto=https, for="[2001:db8::9]"'
        }),
        { trustedProxyHops: 1 }
      )
    ).toBe("2001:db8::9");
  });

  it("falls back to the peer when the forwarding chain is shorter than hops", () => {
    expect(
      resolveClientIp(peer("10.0.0.5", { "x-forwarded-for": "198.51.100.7" }), {
        trustedProxyHops: 2
      })
    ).toBe("10.0.0.5");
  });

  it("normalizes the selected address before returning it", () => {
    expect(
      resolveClientIp(
        peer("::ffff:10.0.0.5", { "x-forwarded-for": "::ffff:198.51.100.7" }),
        { trustedProxyHops: 1 }
      )
    ).toBe("198.51.100.7");
  });
});
