import type { RequestHandler } from "express";

/**
 * Mark every response from this router as non-cacheable.
 *
 * Quotes are price commitments tied to one caller's order terms, and secret
 * submissions are order-specific. Neither may be stored by a shared proxy or a
 * browser cache, so the directive is applied to the whole router — success and
 * error responses alike — rather than to individual handlers.
 *
 * `Pragma: no-cache` accompanies `Cache-Control: no-store` for HTTP/1.0
 * intermediaries that do not understand the modern header.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
};
