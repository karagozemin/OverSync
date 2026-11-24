import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { healthRoutes } from "../src/server/routes/health.js";
import { createReadinessRateLimiter } from "../src/server/readiness-rate-limit.js";

function mountLimiter(options: Parameters<typeof createReadinessRateLimiter>[0] = {}) {
  const app = express();
  app.use(createReadinessRateLimiter(options));
  app.use((_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("createReadinessRateLimiter", () => {
  describe("success path (under limit)", () => {
    it("returns 200, calls next, and sets rate-limit headers without Retry-After", async () => {
      const app = mountLimiter({ limit: 5, windowMs: 60_000 });

      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(res.headers["retry-after"]).toBeUndefined();
      expect(res.headers["x-ratelimit-limit"]).toBe("5");
      expect(res.headers["x-ratelimit-remaining"]).toBe("4");
    });

    it("decrements remaining per request within the same window", async () => {
      const app = mountLimiter({ limit: 2, windowMs: 60_000 });

      await request(app).get("/");
      const second = await request(app).get("/");

      expect(second.status).toBe(200);
      expect(second.headers["x-ratelimit-remaining"]).toBe("0");
    });
  });

  describe("failure path (over limit)", () => {
    it("returns 429 with Retry-After derived from the remaining window and a stable JSON body", async () => {
      const app = mountLimiter({ limit: 1, windowMs: 60_000 });

      await request(app).get("/");
      const res = await request(app).get("/");

      expect(res.status).toBe(429);
      const retryAfter = Number(res.headers["retry-after"]);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      expect(res.body).toMatchObject({
        error: "rate_limited",
        message: "Too many health or readiness requests",
        retryAfterSeconds: retryAfter
      });
    });
  });

  describe("reset boundary", () => {
    it("resets the bucket once the window elapses", async () => {
      const now = vi.fn(() => 0);
      const app = mountLimiter({ limit: 1, windowMs: 60_000, now });

      expect((await request(app).get("/")).status).toBe(200);

      const over = await request(app).get("/");
      expect(over.status).toBe(429);
      expect(Number(over.headers["retry-after"])).toBe(60);

      // Advance the clock exactly to the window boundary: the bucket must reset.
      now.mockReturnValue(60_000);
      const reset = await request(app).get("/");
      expect(reset.status).toBe(200);
      expect(reset.headers["retry-after"]).toBeUndefined();
    });

    it("computes Retry-After from the remaining window mid-window", async () => {
      const now = vi.fn(() => 0);
      const app = mountLimiter({ limit: 1, windowMs: 60_000, now });

      await request(app).get("/");
      // Advance the clock halfway through the window before the next request.
      now.mockReturnValue(30_000);
      const res = await request(app).get("/");

      expect(res.status).toBe(429);
      expect(Number(res.headers["retry-after"])).toBe(30);
      expect(res.body.retryAfterSeconds).toBe(30);
    });
  });

  describe("every 429 response through a real route", () => {
    it("GET /health returns Retry-After when rate limited", async () => {
      const app = express();
      app.use(healthRoutes({ limit: 1, windowMs: 60_000 }));

      await request(app).get("/health");
      const res = await request(app).get("/health");

      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(res.body.error).toBe("rate_limited");
      expect(typeof res.body.retryAfterSeconds).toBe("number");
    });
  });
});
