import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import {
  createRequestIdMiddleware,
  MAX_REQUEST_ID_LENGTH,
} from "../src/server/request-id.js";

type TestLogger = Logger & {
  logs: Array<{ level: string; msg: string; obj?: unknown }>;
};

/** Captures pino log output so logging behaviour can be asserted. */
function makeLog(): TestLogger {
  const logs: TestLogger["logs"] = [];
  const record = (level: string) => (obj: unknown, msg?: string) => {
    logs.push({ level, msg: msg ?? String(obj), obj });
  };
  const log = {
    logs,
    trace: record("trace"),
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    fatal: record("fatal"),
    child: () => log,
    level: "info",
  } as unknown as TestLogger;
  return log;
}

function mountRequestIdMiddleware(log: Logger) {
  const app = express();
  app.use(createRequestIdMiddleware({ log }));
  app.use((_req, res) => res.status(200).json({ ok: true }));
  return app;
}

/** Invokes the middleware handler directly (bypasses HTTP header validation). */
function invokeHandler(log: TestLogger, received: string | undefined) {
  const handler = createRequestIdMiddleware({ log });
  const req = { header: () => received } as unknown as Request;
  const headerSet: Record<string, string> = {};
  const res = {
    setHeader: (key: string, value: string) => {
      headerSet[key.toLowerCase()] = String(value);
    },
  } as unknown as Response;
  let nextCalled = false;
  handler(req, res, (() => {
    nextCalled = true;
  }) as NextFunction);
  return { headerSet, nextCalled };
}

describe("MAX_REQUEST_ID_LENGTH", () => {
  it("documents a maximum header length of 128", () => {
    expect(MAX_REQUEST_ID_LENGTH).toBe(128);
  });
});

describe("createRequestIdMiddleware", () => {
  describe("response header (over HTTP)", () => {
    it("echoes a valid client X-Request-Id back on the response header without logging", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      const res = await request(app)
        .get("/")
        .set("x-request-id", "client-abc-123");

      expect(res.status).toBe(200);
      expect(String(res.headers["x-request-id"])).toBe("client-abc-123");
      expect(log.logs).toHaveLength(0);
    });

    it("generates a safe server id when the header is missing", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      const res = await request(app).get("/");

      expect(res.status).toBe(200);
      const id = String(res.headers["x-request-id"]);
      expect(id).toMatch(/^oversync-[0-9a-f]{16}$/);
      expect(log.logs).toHaveLength(1);
      expect(log.logs[0]!.level).toBe("warn");
    });

    it("generates a safe server id when the header is empty", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      const res = await request(app).get("/").set("x-request-id", "");

      expect(String(res.headers["x-request-id"])).toMatch(
        /^oversync-[0-9a-f]{16}$/
      );
      expect(log.logs).toHaveLength(1);
    });

    it("truncates ids longer than the documented maximum", async () => {
      const log = makeLog();
      const longId = "a".repeat(200);
      const app = mountRequestIdMiddleware(log);

      const res = await request(app).get("/").set("x-request-id", longId);

      const id = String(res.headers["x-request-id"]);
      expect(id).toHaveLength(MAX_REQUEST_ID_LENGTH);
      expect(id).toBe("a".repeat(MAX_REQUEST_ID_LENGTH));
      expect(log.logs).toHaveLength(1);
    });

    it("always sets the X-Request-Id response header", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      const res = await request(app).get("/");

      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });

  describe("sanitisation (handler level)", () => {
    it("strips control characters from the client id", () => {
      const log = makeLog();
      const { headerSet, nextCalled } = invokeHandler(
        log,
        "trace\u0001id\u007f"
      );

      expect(nextCalled).toBe(true);
      expect(headerSet["x-request-id"]!).toBe("traceid");
      expect(log.logs).toHaveLength(1);
      expect(log.logs[0]!.level).toBe("warn");
      expect(
        String((log.logs[0]!.obj as { received?: string })?.received)
      ).toBe("trace\u0001id\u007f");
    });

    it("generates a safe server id when the value is unusable after sanitisation", () => {
      const log = makeLog();
      const { headerSet, nextCalled } = invokeHandler(log, "\u0000\u001f");

      expect(nextCalled).toBe(true);
      expect(String(headerSet["x-request-id"]!)).toMatch(
        /^oversync-[0-9a-f]{16}$/
      );
      expect(log.logs).toHaveLength(1);
      expect(log.logs[0]!.level).toBe("warn");
      expect(String(log.logs[0]!.msg)).toContain("generated safe server id");
      expect(
        String((log.logs[0]!.obj as { received?: string })?.received)
      ).toBe("\u0000\u001f");
    });
  });

  describe("logging", () => {
    it("does not log when a valid id is supplied", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      await request(app).get("/").set("x-request-id", "valid-id");

      expect(log.logs).toHaveLength(0);
    });

    it("logs a warning when an invalid id is substituted", async () => {
      const log = makeLog();
      const app = mountRequestIdMiddleware(log);

      await request(app).get("/").set("x-request-id", "");

      expect(log.logs).toHaveLength(1);
      expect(log.logs[0]!.level).toBe("warn");
      expect(String(log.logs[0]!.msg)).toContain("generated safe server id");
    });
  });
});
