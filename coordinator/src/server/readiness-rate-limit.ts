import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface ReadinessRateLimitOptions {
  /** Maximum requests per client in the window. */
  limit?: number;
  /** Window duration in milliseconds. */
  windowMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Small in-process limiter for public diagnostics. Health/readiness are
 * intentionally cheap, but unrestricted polling can still exhaust logs and
 * upstream dependency checks. A bounded map is sufficient for one process;
 * deployments with multiple replicas should enforce the same policy at the
 * edge as well.
 */
export function createReadinessRateLimiter(options: ReadinessRateLimitOptions = {}): RequestHandler {
  const limit = Math.max(1, Math.floor(options.limit ?? 30));
  const windowMs = Math.max(1_000, Math.floor(options.windowMs ?? 60_000));
  const now = options.now ?? (() => Date.now());
  const buckets = new Map<string, { startedAt: number; count: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const timestamp = now();
    const current = buckets.get(key);
    const bucket = !current || timestamp - current.startedAt >= windowMs
      ? { startedAt: timestamp, count: 0 }
      : current;

    bucket.count += 1;
    buckets.set(key, bucket);

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((bucket.startedAt + windowMs) / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - timestamp) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "rate_limited",
        message: "Too many health or readiness requests",
        retryAfterSeconds: retryAfter
      });
      return;
    }

    next();
  };
}
