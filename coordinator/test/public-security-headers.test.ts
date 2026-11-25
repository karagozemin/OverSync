import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { registry } from "../src/metrics.js";
import { healthRoutes } from "../src/server/routes/health.js";
import { metricsRoutes } from "../src/server/routes/metrics.js";

function expectSecurityHeaders(headers: Record<string, string | string[] | undefined>) {
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
}

describe("public endpoint security headers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["/health", "/readiness"])("sets headers on successful %s responses", async (path) => {
    const app = express();
    app.use(healthRoutes());

    const response = await request(app).get(path).expect(200);

    expectSecurityHeaders(response.headers);
  });

  it("sets headers on health and readiness rate-limit errors without changing the body", async () => {
    const app = express();
    app.use(healthRoutes({ limit: 1, now: () => 1_000 }));

    await request(app).get("/health").expect(200);
    const response = await request(app)
      .get("/readiness")
      .expect(429);

    expect(response.body).toMatchObject({
      error: "rate_limited",
      message: "Too many health or readiness requests",
      retryAfterSeconds: expect.any(Number)
    });
    expectSecurityHeaders(response.headers);
  });

  it("sets headers on successful metrics responses", async () => {
    const app = express();
    app.use(metricsRoutes());

    const response = await request(app).get("/metrics").expect(200);

    expectSecurityHeaders(response.headers);
  });

  it("sets headers on metrics errors without changing the response body", async () => {
    vi.spyOn(registry, "metrics").mockRejectedValueOnce(new Error("registry failed"));
    const app = express();
    app.use(metricsRoutes());

    const response = await request(app).get("/metrics").expect(500);

    expect(response.text).toBe("Error: registry failed");
    expectSecurityHeaders(response.headers);
  });
});
