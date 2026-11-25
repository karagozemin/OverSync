import { createServer, type RequestListener, type Server } from "node:http";
import { z } from "zod";

/**
 * Hard limits on how long a client may hold a coordinator connection.
 *
 * Without them a client can open a connection, send a header a byte at a time
 * or promise a body it never sends, and keep the socket and its buffers for as
 * long as it likes. Node's own defaults (60 s for headers, 5 minutes for a
 * whole request) are generous, and they are only enforced on a timer, so the
 * limits are set here explicitly and checked often enough to mean what they say.
 */

/** Longest a client may take to send the complete request, headers and body. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Longest a client may take to send the request line and headers. */
export const DEFAULT_HEADERS_TIMEOUT_MS = 10_000;

/** A limit below one second would cut off slow but honest clients. */
export const MIN_TIMEOUT_MS = 1_000;
/** Node's own default request timeout: nothing longer is a tightening. */
export const MAX_TIMEOUT_MS = 300_000;

// Zero would mean "no limit" to Node, which is exactly what this guards against,
// so every value is a bounded positive integer. An unset variable takes the
// default; a variable that is set but empty or not a number is an error.
const timeoutMs = (name: string, fallback: number) =>
  z.coerce
    .number({ invalid_type_error: `${name} must be a number of milliseconds` })
    .int(`${name} must be a whole number of milliseconds`)
    .min(MIN_TIMEOUT_MS, `${name} must be at least ${MIN_TIMEOUT_MS} ms`)
    .max(MAX_TIMEOUT_MS, `${name} must be at most ${MAX_TIMEOUT_MS} ms`)
    .default(fallback);

export const serverTimeoutsSchema = z
  .object({
    requestTimeoutMs: timeoutMs("requestTimeoutMs", DEFAULT_REQUEST_TIMEOUT_MS),
    headersTimeoutMs: timeoutMs("headersTimeoutMs", DEFAULT_HEADERS_TIMEOUT_MS)
  })
  .refine((t) => t.headersTimeoutMs <= t.requestTimeoutMs, {
    // Node refuses to start a server whose headers limit exceeds its request limit.
    message: "headersTimeoutMs must not exceed requestTimeoutMs",
    path: ["headersTimeoutMs"]
  });

export type ServerTimeouts = z.infer<typeof serverTimeoutsSchema>;

/** Read the two limits from the environment, as the raw values `loadConfig` validates. */
export function serverTimeoutsFromEnv(env: NodeJS.ProcessEnv = process.env): {
  requestTimeoutMs: string | undefined;
  headersTimeoutMs: string | undefined;
} {
  return {
    requestTimeoutMs: env.COORDINATOR_REQUEST_TIMEOUT_MS,
    headersTimeoutMs: env.COORDINATOR_HEADERS_TIMEOUT_MS
  };
}

/**
 * How often Node checks open connections against the limits. Its default is 30 s,
 * which would let a 10 s limit run to 40 s, so check at a quarter of the shorter
 * limit instead (never more than once a second, never less than every 100 ms).
 */
export function connectionsCheckingIntervalMs(timeouts: ServerTimeouts): number {
  const shortest = Math.min(timeouts.requestTimeoutMs, timeouts.headersTimeoutMs);
  return Math.min(1_000, Math.max(100, Math.floor(shortest / 4)));
}

/** An HTTP server for the coordinator app with the request limits applied from the start. */
export function createCoordinatorServer(listener: RequestListener, timeouts: ServerTimeouts): Server {
  return createServer(
    {
      requestTimeout: timeouts.requestTimeoutMs,
      headersTimeout: timeouts.headersTimeoutMs,
      connectionsCheckingInterval: connectionsCheckingIntervalMs(timeouts)
    },
    listener
  );
}
