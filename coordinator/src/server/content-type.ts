import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Validates that the Content-Type header is application/json.
 * Accepts an optional charset parameter (e.g., application/json; charset=utf-8).
 * Rejects any missing, empty, or unexpected Content-Type header or unsupported parameters.
 */
export function isValidJsonContentType(
  header: string | string[] | undefined | null,
): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return false;

  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return false;

  const mime = parts[0]!.toLowerCase();
  if (mime !== "application/json") return false;

  for (let i = 1; i < parts.length; i++) {
    const param = parts[i]!.toLowerCase();
    if (!param.startsWith("charset=")) {
      return false;
    }
    const charsetVal = param
      .slice("charset=".length)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!charsetVal) {
      return false;
    }
  }

  return true;
}

export interface JsonContentTypeOptions {
  methods?: string[];
}

/**
 * Middleware that enforces application/json content type on write requests (POST, PUT by default).
 * Returns HTTP 415 with a JSON error payload if the content type is missing or unsupported.
 */
export function requireJsonContentType(
  options: JsonContentTypeOptions = {},
): RequestHandler {
  const methods = new Set(
    (options.methods ?? ["POST", "PUT"]).map((m) => m.toUpperCase()),
  );

  return (req: Request, res: Response, next: NextFunction): void => {
    if (methods.has(req.method.toUpperCase())) {
      const contentType = req.headers["content-type"];
      if (!isValidJsonContentType(contentType)) {
        res.status(415).json({
          error: "unsupported_media_type",
          message: "Content-Type must be application/json",
        });
        return;
      }
    }
    next();
  };
}
