import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createReadinessRateLimiter } from "../src/server/readiness-rate-limit.js";

function makeApp(options: Parameters<typeof createReadinessRateLimiter>[0]) {
  const app = express();
  app.use(createReadinessRateLimiter(options));
  app.get("/probe", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("readiness rate limit client IP", () => {
  it("ignores spoofed X-Forwarded-For by default so one peer shares one bucket", async () => {
    const app = makeApp({ limit: 2, windowMs: 60_000 });

    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.1")
      .expect(200);
    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.2")
      .expect(200);

    const blocked = await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.3")
      .expect(429);

    expect(blocked.body.error).toBe("rate_limited");
  });

  it("ignores spoofed Forwarded headers by default", async () => {
    const app = makeApp({ limit: 1, windowMs: 60_000 });

    await request(app)
      .get("/probe")
      .set("Forwarded", "for=198.51.100.9")
      .expect(200);

    await request(app)
      .get("/probe")
      .set("Forwarded", "for=203.0.113.9")
      .expect(429);
  });

  it("keys buckets on forwarded client IPs when trusted-proxy hops are set", async () => {
    const app = makeApp({ limit: 1, windowMs: 60_000, trustedProxyHops: 1 });

    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.10")
      .expect(200);

    // Different claimed client IP → separate bucket → still allowed.
    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.11")
      .expect(200);

    // Same claimed client IP → shared bucket → blocked.
    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.10")
      .expect(429);
  });

  it("normalizes IPv4-mapped forms so equivalent addresses share a bucket", async () => {
    const app = makeApp({ limit: 1, windowMs: 60_000, trustedProxyHops: 1 });

    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "::ffff:198.51.100.40")
      .expect(200);

    await request(app)
      .get("/probe")
      .set("X-Forwarded-For", "198.51.100.40")
      .expect(429);
  });
});
