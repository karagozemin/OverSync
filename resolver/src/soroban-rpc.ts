import { rpc } from '@stellar/stellar-sdk';
import {
  createBoundedFetch,
  DEFAULT_MAX_RPC_RESPONSE_BYTES,
  type FetchLike,
  type RpcChain
} from './rpc-response-limit.js';

/** Soroban RPC calls issued by the chain listeners. */
export interface SorobanRpcClient {
  getLatestLedger(): Promise<rpc.Api.GetLatestLedgerResponse>;
  getEvents(request: rpc.Server.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
}

export interface SorobanRpcClientOptions {
  /** Allow plain http endpoints. Local development only. */
  allowHttp?: boolean;
  /** Responses larger than this many bytes are rejected before parsing. */
  maxResponseBytes?: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Transport override, mainly for tests. */
  fetchImpl?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Minimal Soroban JSON-RPC client for the listeners.
 *
 * The SDK's `rpc.Server` buffers a response before the caller can inspect it,
 * which is exactly what a hostile or misconfigured endpoint exploits. These two
 * read-only calls are the only ones the listeners make, so they are issued
 * directly over `fetch` and read through the bounded reader in
 * `rpc-response-limit.ts`. Event decoding is still delegated to the SDK
 * (`rpc.parseRawEvents`), so the listener sees the same shapes it always did.
 *
 * @see coordinator/src/soroban-rpc.ts — keep in sync when changing behaviour.
 */
export function createSorobanRpcClient(
  serverUrl: string,
  options: SorobanRpcClientOptions = {}
): SorobanRpcClient {
  const url = new URL(serverUrl);
  if (url.protocol !== 'https:' && !options.allowHttp) {
    throw new Error('Soroban RPC URL must use https; set allowHttp only for local development');
  }

  const chain: RpcChain = 'soroban';
  const limit = options.maxResponseBytes ?? DEFAULT_MAX_RPC_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const boundedFetch = createBoundedFetch(chain, limit, options.fetchImpl);

  async function post(method: string, params: unknown): Promise<unknown> {
    const response = await boundedFetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Soroban RPC ${method} failed with HTTP ${response.status}`);
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Soroban RPC ${method} returned a body that is not valid JSON`);
    }

    if (payload && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error?: { code?: number; message?: string } }).error;
      const code = error?.code === undefined ? '' : ` ${error.code}`;
      throw new Error(`Soroban RPC ${method} error${code}: ${error?.message ?? 'unknown error'}`);
    }

    return (payload as { result?: unknown } | null)?.result;
  }

  return {
    async getLatestLedger() {
      return (await post('getLatestLedger', null)) as rpc.Api.GetLatestLedgerResponse;
    },

    async getEvents(request) {
      const pagination: Record<string, number | string> = {};
      if (request.cursor) pagination.cursor = request.cursor;
      if (request.limit) pagination.limit = request.limit;

      const params = {
        filters: request.filters ?? [],
        pagination,
        ...(request.startLedger ? { startLedger: request.startLedger } : {}),
        ...(request.endLedger ? { endLedger: request.endLedger } : {})
      };

      const raw = (await post('getEvents', params)) as rpc.Api.RawGetEventsResponse;
      return rpc.parseRawEvents(raw);
    }
  };
}
