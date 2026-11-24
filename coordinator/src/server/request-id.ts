import { randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Logger } from "pino";

/**
 * Documented maximum length of the `X-Request-Id` header.
 *
 * Oversized IDs inflate logs and can corrupt cross-chain trace output,
 * so clients may not send an ID longer than this. Values exceeding the
 * limit are truncated to it.
 */
export const MAX_REQUEST_ID_LENGTH = 128;

/** Prefix for server-generated fallback IDs when a client value is unusable. */
const SERVER_ID_PREFIX = "oversync-";

/** Control characters and DEL that must never appear in a trace ID. */
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Sanitise and stabilise the `X-Request-Id` header on every response.
 *
 * - A missing or empty ID is replaced with a safe server-generated ID.
 * - Control characters are stripped from client-supplied values.
 * - Values longer than `MAX_REQUEST_ID_LENGTH` are truncated to it.
 * - When the supplied value is unusable (empty after sanitisation) a
 *   server ID is generated instead, and the substitution is logged.
 *
 * The (sanitised or generated) ID is echoed back on the
 * `X-Request-Id` response header so clients and traces share one value.
 */
export function createRequestIdMiddleware(options: { log?: Logger } = {}): RequestHandler {
  const log = options.log;

  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req.header("x-request-id");
    let id = typeof raw === "string" ? raw : "";
    let substituted = false;

    if (id.length === 0) {
      substituted = true;
    } else {
      const sanitised = id.replace(UNSAFE_CHARS, "").slice(0, MAX_REQUEST_ID_LENGTH);
      if (sanitised.length === 0 || sanitised.length !== id.length) {
        substituted = true;
      }
      id = sanitised;
    }

    if (id.length === 0) {
      id = `${SERVER_ID_PREFIX}${randomBytes(8).toString("hex")}`;
      substituted = true;
    }

    if (substituted && log) {
      log.warn(
        { requestId: id, received: typeof raw === "string" ? raw : undefined },
        "invalid or missing X-Request-Id; generated safe server id"
      );
    }

    res.setHeader("X-Request-Id", id);
    next();
  };
}
