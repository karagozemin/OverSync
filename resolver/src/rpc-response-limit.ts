/**
 * Byte ceiling for the JSON-RPC responses read by the chain listeners.
 *
 * A compromised or misconfigured Ethereum / Soroban RPC endpoint can answer a
 * long-running listener with an arbitrarily large body. Every listener request
 * therefore goes through this module, which counts the bytes as they arrive and
 * aborts as soon as the documented limit is crossed — before the body is
 * buffered in full and before anything is handed to `JSON.parse`.
 *
 * The error raised on an oversized body is deliberately redacted: it carries
 * the chain, the configured limit and the number of bytes observed, but never
 * the body and never the RPC URL (which may embed a provider API key).
 *
 * The limit is configured with `RPC_MAX_RESPONSE_BYTES`; invalid values make
 * the process refuse to start rather than silently disabling the cap.
 *
 * @see coordinator/src/rpc-response-limit.ts — keep in sync when changing rules.
 */

/** Default ceiling for one JSON-RPC HTTP response: 8 MiB. */
export const DEFAULT_MAX_RPC_RESPONSE_BYTES = 8_388_608;

/** Environment variable that overrides {@link DEFAULT_MAX_RPC_RESPONSE_BYTES}. */
export const RPC_MAX_RESPONSE_BYTES_ENV = 'RPC_MAX_RESPONSE_BYTES';

/** Stable `code` carried by {@link RpcResponseTooLargeError}. */
export const RPC_RESPONSE_TOO_LARGE = 'RPC_RESPONSE_TOO_LARGE';

/** Chain a bounded response was read from. */
export type RpcChain = 'ethereum' | 'soroban';

/**
 * Raised when a JSON-RPC response body exceeds the configured byte limit.
 *
 * Typed so callers can tell a deliberate size rejection apart from a network
 * or decoding failure. Contains no part of the rejected body and no endpoint
 * URL, so it is safe to log.
 */
export class RpcResponseTooLargeError extends Error {
  readonly code = RPC_RESPONSE_TOO_LARGE;
  readonly chain: RpcChain;
  readonly limitBytes: number;
  /** Bytes seen before the read was abandoned, or the declared Content-Length. */
  readonly observedBytes: number | null;

  constructor(chain: RpcChain, limitBytes: number, observedBytes: number | null = null) {
    super(
      `${chain} JSON-RPC response exceeded the ${limitBytes} byte limit` +
        (observedBytes === null ? '' : ` (${observedBytes} bytes received)`) +
        '; the body was discarded without being parsed or logged'
    );
    this.name = 'RpcResponseTooLargeError';
    this.chain = chain;
    this.limitBytes = limitBytes;
    this.observedBytes = observedBytes;
  }
}

/**
 * Parse the configured limit. Unset means {@link DEFAULT_MAX_RPC_RESPONSE_BYTES};
 * anything that is not a positive integer is rejected so a typo cannot quietly
 * remove the cap.
 */
export function parseMaxResponseBytes(
  raw: string | undefined,
  envName: string = RPC_MAX_RESPONSE_BYTES_ENV
): number {
  if (raw === undefined) return DEFAULT_MAX_RPC_RESPONSE_BYTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${envName} must be a positive integer number of bytes (default ${DEFAULT_MAX_RPC_RESPONSE_BYTES}), got: ${JSON.stringify(raw)}`
    );
  }
  return parsed;
}

/** A fetch-compatible function, so tests (and callers) can inject a transport. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read a response body while counting bytes, throwing
 * {@link RpcResponseTooLargeError} as soon as `limit` is crossed. A body of
 * exactly `limit` bytes is accepted.
 */
export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  chain: RpcChain
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new RpcResponseTooLargeError(chain, limit, total);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatChunks(chunks, total);
}

/**
 * Wrap a fetch implementation so every response body it returns has been read
 * through {@link readBodyWithLimit}. The rebuilt `Response` keeps the status and
 * headers (minus the now-stale `content-length` / `content-encoding`) so viem
 * and other callers see an ordinary response for bodies within the limit.
 */
export function createBoundedFetch(
  chain: RpcChain,
  limit: number,
  fetchImpl: FetchLike = fetch
): FetchLike {
  return async (input, init) => {
    const response = await fetchImpl(input, init);

    const declared = declaredContentLength(response.headers);
    if (declared !== null && declared > limit) {
      await response.body?.cancel().catch(() => undefined);
      throw new RpcResponseTooLargeError(chain, limit, declared);
    }

    if (!response.body) return response;

    const bytes = await readBodyWithLimit(response.body, limit, chain);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');

    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  };
}
