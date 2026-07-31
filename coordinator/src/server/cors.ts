import cors from "cors";
import type { RequestHandler } from "express";

export function parseCorsOrigins(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const origins = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (origin !== "*") {
      try {
        new URL(origin);
      } catch {
        throw new Error(
          `Invalid CORS origin: "${origin}". ` +
            'Each origin must be a valid URL (e.g. "https://example.com") or "*" for all origins.'
        );
      }
    }
  }

  return origins;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[]
): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

export function createCorsMiddleware(
  allowedOrigins: string[]
): RequestHandler {
  return cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  });
}
