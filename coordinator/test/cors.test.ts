import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import {
  parseCorsOrigins,
  isOriginAllowed,
  createCorsMiddleware,
} from "../src/server/cors.js";

describe("parseCorsOrigins", () => {
  it("parses a single origin", () => {
    expect(parseCorsOrigins("https://app.oversync.xyz")).toEqual([
      "https://app.oversync.xyz",
    ]);
  });

  it("parses comma-separated origins", () => {
    expect(
      parseCorsOrigins(
        "https://app.oversync.xyz,https://admin.oversync.xyz"
      )
    ).toEqual([
      "https://app.oversync.xyz",
      "https://admin.oversync.xyz",
    ]);
  });

  it("trims whitespace around origins", () => {
    expect(
      parseCorsOrigins("  https://app.oversync.xyz ,  https://admin.oversync.xyz  ")
    ).toEqual([
      "https://app.oversync.xyz",
      "https://admin.oversync.xyz",
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseCorsOrigins("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseCorsOrigins("   ")).toEqual([]);
  });

  it("filters out empty entries from trailing commas", () => {
    expect(parseCorsOrigins("https://app.oversync.xyz,")).toEqual([
      "https://app.oversync.xyz",
    ]);
  });

  it("handles single wildcard", () => {
    expect(parseCorsOrigins("*")).toEqual(["*"]);
  });

  it("throws for malformed single origin that is not a URL", () => {
    expect(() => parseCorsOrigins("not-a-url")).toThrow("Invalid CORS origin");
  });

  it("throws when a comma-separated list contains an invalid origin", () => {
    expect(() =>
      parseCorsOrigins("https://valid.com,not-a-url")
    ).toThrow("Invalid CORS origin");
  });

  it("throws when all entries are invalid", () => {
    expect(() => parseCorsOrigins("bad1,bad2")).toThrow(
      "Invalid CORS origin"
    );
  });
});

describe("isOriginAllowed", () => {
  const allowedOrigins = [
    "https://app.oversync.xyz",
    "https://admin.oversync.xyz",
  ];

  it("allows matching origin", () => {
    expect(isOriginAllowed("https://app.oversync.xyz", allowedOrigins)).toBe(
      true
    );
  });

  it("allows another matching origin", () => {
    expect(
      isOriginAllowed("https://admin.oversync.xyz", allowedOrigins)
    ).toBe(true);
  });

  it("denies non-matching origin", () => {
    expect(isOriginAllowed("https://evil.com", allowedOrigins)).toBe(false);
  });

  it("allows request without origin (server-to-server)", () => {
    expect(isOriginAllowed(undefined, allowedOrigins)).toBe(true);
  });

  it("allows any origin when wildcard is present", () => {
    expect(isOriginAllowed("https://evil.com", ["*"])).toBe(true);
  });

  it("denies request when allowlist is empty", () => {
    expect(isOriginAllowed("https://app.oversync.xyz", [])).toBe(false);
  });

  it("allows server-to-server when allowlist is empty", () => {
    expect(isOriginAllowed(undefined, [])).toBe(true);
  });
});

describe("CORS middleware", () => {
  function testApp(allowedOrigins: string[]) {
    const app = express();
    app.use(createCorsMiddleware(allowedOrigins));
    app.get("/test", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("returns CORS headers for allowed origin", async () => {
    const res = await request(testApp(["https://app.oversync.xyz"]))
      .get("/test")
      .set("Origin", "https://app.oversync.xyz");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.oversync.xyz"
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("omits CORS headers for denied origin", async () => {
    const res = await request(testApp(["https://app.oversync.xyz"]))
      .get("/test")
      .set("Origin", "https://evil.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows request without Origin header", async () => {
    const res = await request(testApp(["https://app.oversync.xyz"]))
      .get("/test");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows any origin with wildcard allowlist", async () => {
    const res = await request(testApp(["*"]))
      .get("/test")
      .set("Origin", "https://anywhere.com");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://anywhere.com"
    );
  });

  it("allows requests with no Origin when allowlist is empty", async () => {
    const res = await request(testApp([]))
      .get("/test");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("omits CORS headers for any origin when allowlist is empty", async () => {
    const res = await request(testApp([]))
      .get("/test")
      .set("Origin", "https://app.oversync.xyz");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("handles preflight OPTIONS request for allowed origin", async () => {
    const res = await request(testApp(["https://app.oversync.xyz"]))
      .options("/test")
      .set("Origin", "https://app.oversync.xyz")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://app.oversync.xyz"
    );
  });

  it("omits CORS headers on preflight OPTIONS for denied origin", async () => {
    const res = await request(testApp(["https://app.oversync.xyz"]))
      .options("/test")
      .set("Origin", "https://evil.com")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
