/**
 * @fileoverview WebSocket server for 1inch Fusion+ real-time events
 * @description Event-driven architecture with real-time notifications
 */

import { EventEmitter } from 'events';
import { createServer } from 'http';

// Simple UUID generator
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// WebSocket types (simplified)
interface WebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: string, callback: (...args: any[]) => void): void;
}

interface WebSocketServer {
  on(event: string, callback: (...args: any[]) => void): void;
  close(callback?: () => void): void;
}

// ---------------------------------------------------------------------------
// Origin policy — mirrors coordinator/src/server/cors.ts
// ---------------------------------------------------------------------------

/** Same default as the coordinator's `corsOrigins` config. */
export const DEFAULT_ALLOWED_ORIGINS =
  'http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173';

/** WebSocket close code for a policy violation (RFC 6455 §7.4.1). */
export const WS_POLICY_VIOLATION = 1008;

/**
 * Stable close code sent to a client that stopped answering heartbeats.
 * 4001 sits in the RFC 6455 §7.4.2 private-use range, so it cannot collide
 * with a protocol-defined code.
 */
export const WS_HEARTBEAT_TIMEOUT_CODE = 4001;

/** Close reason paired with {@link WS_HEARTBEAT_TIMEOUT_CODE}. */
export const WS_HEARTBEAT_TIMEOUT_REASON = 'heartbeat timeout';

/** Default ping cadence: one ping sweep every 30 seconds. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/** Default idle window: one unanswered ping closes the socket. */
export const DEFAULT_IDLE_TIMEOUT_MS = 2 * DEFAULT_HEARTBEAT_INTERVAL_MS;

export interface HeartbeatOptions {
  /** How often a protocol-level ping is sent to every connected client. */
  heartbeatIntervalMs?: number;
  /**
   * Maximum time a client may go without a pong before it is closed. Must be
   * greater than `heartbeatIntervalMs` so the client always gets a chance to
   * answer at least one ping.
   */
  idleTimeoutMs?: number;
}

function positiveMilliseconds(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number of milliseconds`);
  }
  return value;
}

/**
 * Parse a comma-separated origin allowlist exactly like the coordinator's
 * `parseCorsOrigins`, so the socket and the HTTP API admit the same set.
 */
export function parseAllowedOrigins(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const origins = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (origin !== '*') {
      try {
        new URL(origin);
      } catch {
        throw new Error(`Invalid CORS origin: "${origin}".`);
      }
    }
  }
  return origins;
}

/** Read the allowlist from the same env vars the coordinator uses. */
export function allowedOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseAllowedOrigins(env.COORDINATOR_CORS_ORIGINS ?? env.CORS_ORIGIN ?? DEFAULT_ALLOWED_ORIGINS);
}

/**
 * Unlike HTTP CORS (where a missing Origin means a non-browser caller), a
 * socket that may carry order data is only accepted with an explicit
 * allowlisted Origin.
 */
export function isSocketOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes('*')) return true;
  return allowedOrigins.includes(origin);
}

// ---------------------------------------------------------------------------
// Outbound redaction
// ---------------------------------------------------------------------------

/** Keys whose values must never leave the relayer on the socket. */
const REDACTED_KEYS = new Set([
  'secret',
  'secrets',
  'preimage',
  'preimages',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie'
]);

/** `scheme://user:pass@host` → `scheme://host` */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

/**
 * Deep-copy a value, dropping preimages/secrets and auth headers and
 * stripping userinfo from any URL string. Order ids, hashes and status
 * are kept untouched.
 */
export function redactOutbound<T>(value: T): T {
  return redactValue(value, new WeakSet()) as T;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return value.replace(URL_USERINFO, '$1');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) continue;
    out[key] = redactValue(v, seen);
  }
  return out;
}

// 1inch Fusion+ compliant event types
export enum EventType {
  OrderCreated = 'order_created',
  OrderInvalid = 'order_invalid',
  OrderBalanceChange = 'order_balance_change',
  OrderAllowanceChange = 'order_allowance_change',
  OrderFilled = 'order_filled',
  OrderFilledPartially = 'order_filled_partially',
  OrderCancelled = 'order_cancelled',
  SecretShared = 'secret_shared'
}

// RPC methods (1inch compliant)
export enum RpcMethod {
  GetAllowedMethods = 'getAllowedMethods',
  Ping = 'ping',
  GetActiveOrders = 'getActiveOrders',
  GetSecrets = 'getSecrets'
}

// WebSocket message structure
export interface WebSocketMessage {
  id?: string;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  event?: EventType;
  data?: any;
}

// Event data structures (1inch compliant)
export interface OrderCreatedEvent {
  event: EventType.OrderCreated;
  data: {
    srcChainId: number;
    dstChainId: number;
    orderHash: string;
    order: any;
    extension: string;
    signature: string;
    isMakerContract: boolean;
    quoteId: string;
    merkleLeaves: string[];
    secretHashes: string[];
  };
}

export interface OrderFilledEvent {
  event: EventType.OrderFilled;
  data: {
    orderHash: string;
    fillAmount: string;
    resolver: string;
    txHash: string;
    timestamp: number;
  };
}

export interface OrderFilledPartiallyEvent {
  event: EventType.OrderFilledPartially;
  data: {
    orderHash: string;
    fragmentIndex: number;
    fillAmount: string;
    remainingAmount: string;
    resolver: string;
    fillPercentage: number;
    txHash: string;
    timestamp: number;
  };
}

export interface OrderCancelledEvent {
  event: EventType.OrderCancelled;
  data: {
    orderHash: string;
    reason: string;
    timestamp: number;
  };
}

export interface SecretSharedEvent {
  event: EventType.SecretShared;
  data: {
    orderHash: string;
    secretIndex: number;
    secret: string;
    resolver: string;
    timestamp: number;
  };
}

// Client connection interface
export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<EventType>;
  orderFilters: Set<string>; // Specific order hashes
  resolverFilters: Set<string>; // Specific resolver addresses
  chainFilters: Set<number>; // Specific chain IDs
  /** Unix ms of the most recent pong (or of the handshake before the first one). */
  lastPongAt: number;
  metadata: {
    userAgent?: string;
    ip?: string;
    connectedAt: number;
  };
}

// Event history for replay
export interface EventRecord {
  id: string;
  timestamp: number;
  event: EventType;
  data: any;
  orderHash?: string;
  resolver?: string;
  chainId?: number;
}

export class FusionWebSocketServer extends EventEmitter {
  private httpServer: any;
  private clients: Map<string, WebSocketClient> = new Map();
  private eventHistory: EventRecord[] = [];
  private readonly MAX_HISTORY_SIZE = 1000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs: number;
  private readonly idleTimeoutMs: number;
  private isRunning = false;
  private readonly allowedOrigins: string[];

  constructor(
    private port: number = 3002,
    allowedOrigins: string[] = allowedOriginsFromEnv(),
    heartbeat: HeartbeatOptions = {}
  ) {
    super();
    this.httpServer = createServer();
    this.allowedOrigins = allowedOrigins;
    this.heartbeatIntervalMs = positiveMilliseconds(
      heartbeat.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      'heartbeatIntervalMs'
    );
    this.idleTimeoutMs = positiveMilliseconds(
      heartbeat.idleTimeoutMs,
      DEFAULT_IDLE_TIMEOUT_MS,
      'idleTimeoutMs'
    );
    // At or below the ping cadence the client would be dropped before it had a
    // chance to answer even one ping.
    if (this.idleTimeoutMs <= this.heartbeatIntervalMs) {
      throw new Error('idleTimeoutMs must be greater than heartbeatIntervalMs');
    }
  }

  /**
   * Admit a new socket. The connection is closed with 1008 before it is
   * registered (and therefore before any order message) when the Origin
   * header is missing or not on the coordinator CORS allowlist.
   *
   * Returns the registered client, or `null` when the socket was refused.
   */
  handleConnection(
    socket: WebSocket,
    request: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }
  ): WebSocketClient | null {
    const rawOrigin = request.headers['origin'];
    const origin = Array.isArray(rawOrigin) ? undefined : rawOrigin;
    if (!isSocketOriginAllowed(origin, this.allowedOrigins)) {
      socket.close(WS_POLICY_VIOLATION, 'origin not allowed');
      return null;
    }

    const userAgent = request.headers['user-agent'];
    const client: WebSocketClient = {
      id: generateUUID(),
      socket,
      subscriptions: new Set(),
      orderFilters: new Set(),
      resolverFilters: new Set(),
      chainFilters: new Set(),
      lastPongAt: Date.now(),
      metadata: {
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
        ip: request.socket?.remoteAddress,
        connectedAt: Date.now()
      }
    };
    this.clients.set(client.id, client);
    this.ensureHeartbeat();

    socket.on('message', (raw: unknown) => {
      let message: WebSocketMessage;
      try {
        message = JSON.parse(String(raw));
      } catch {
        this.sendError(client, -32700, 'Parse error');
        return;
      }
      this.handleClientMessage(client, message);
    });
    socket.on('pong', () => {
      client.lastPongAt = Date.now();
    });
    socket.on('close', () => {
      this.removeClient(client.id);
    });
    socket.on('error', () => {
      this.removeClient(client.id);
    });

    return client;
  }

  /**
   * Start WebSocket server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer.listen(this.port, () => {
          console.log(`🌐 WebSocket server started on port ${this.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop WebSocket server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.stopHeartbeat();

      // Close all client connections
      this.clients.forEach(client => {
        client.socket.close();
      });
      this.clients.clear();

      this.httpServer.close(() => {
        console.log('🌐 WebSocket server stopped');
        resolve();
      });
    });
  }

  /**
   * Setup WebSocket connection handlers
   */
  private setupWebSocketHandlers(): void {
    // WebSocket server setup would go here in full implementation
    // For now, this is a placeholder for the event system architecture
    console.log('🔌 WebSocket handler setup completed');
  }

  /**
   * Handle client RPC and subscription messages
   */
  handleClientMessage(client: WebSocketClient, message: WebSocketMessage): void {
    const { id, method, params } = message;

    if (!method) {
      this.sendError(client, -32600, 'Invalid Request', 'Method is required');
      return;
    }

    switch (method) {
      case RpcMethod.Ping:
        this.handlePing(client, id);
        break;

      case RpcMethod.GetAllowedMethods:
        this.handleGetAllowedMethods(client, id);
        break;

      case RpcMethod.GetActiveOrders:
        this.handleGetActiveOrders(client, id, params);
        break;

      case 'subscribe':
        this.handleSubscribe(client, id, params);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(client, id, params);
        break;

      case 'getEventHistory':
        this.handleGetEventHistory(client, id, params);
        break;

      default:
        this.sendError(client, -32601, 'Method not found', `Unknown method: ${method}`);
    }
  }

  /**
   * Handle ping RPC method
   */
  private handlePing(client: WebSocketClient, id?: string): void {
    this.sendResponse(client, id, 'pong');
  }

  /**
   * Handle getAllowedMethods RPC method
   */
  private handleGetAllowedMethods(client: WebSocketClient, id?: string): void {
    const methods = [
      ...Object.values(RpcMethod),
      'subscribe',
      'unsubscribe',
      'getEventHistory'
    ];
    this.sendResponse(client, id, methods);
  }

  /**
   * Handle getActiveOrders RPC method
   *
   * The v1 implementation returned a hard-coded fake order
   * (`0x1234567890abcdef`). That is gone. The v2 coordinator owns this
   * data; until it is wired up we return an empty array rather than
   * fabricated entries.
   */
  private handleGetActiveOrders(client: WebSocketClient, id?: string, _params?: any): void {
    this.sendResponse(client, id, {
      orders: [],
      notice: 'WebSocket order index is being migrated to the v2 coordinator. See ARCHITECTURE.md.'
    });
  }

  /**
   * Handle event subscriptions
   */
  private handleSubscribe(client: WebSocketClient, id?: string, params?: any): void {
    const { events, orderHashes, resolvers, chainIds } = params || {};

    // Subscribe to events
    if (events && Array.isArray(events)) {
      events.forEach(event => {
        if (Object.values(EventType).includes(event)) {
          client.subscriptions.add(event);
        }
      });
    }

    // Add filters
    if (orderHashes && Array.isArray(orderHashes)) {
      orderHashes.forEach(hash => client.orderFilters.add(hash));
    }

    if (resolvers && Array.isArray(resolvers)) {
      resolvers.forEach(resolver => client.resolverFilters.add(resolver));
    }

    if (chainIds && Array.isArray(chainIds)) {
      chainIds.forEach(chainId => client.chainFilters.add(chainId));
    }

    this.sendResponse(client, id, {
      subscribed: true,
      events: Array.from(client.subscriptions),
      filters: {
        orders: Array.from(client.orderFilters),
        resolvers: Array.from(client.resolverFilters),
        chains: Array.from(client.chainFilters)
      }
    });

    console.log(`📡 Client ${client.id} subscribed to ${client.subscriptions.size} events`);
  }

  /**
   * Handle event unsubscriptions
   */
  private handleUnsubscribe(client: WebSocketClient, id?: string, params?: any): void {
    const { events, orderHashes, resolvers, chainIds } = params || {};

    // Unsubscribe from events
    if (events && Array.isArray(events)) {
      events.forEach(event => client.subscriptions.delete(event));
    }

    // Remove filters
    if (orderHashes && Array.isArray(orderHashes)) {
      orderHashes.forEach(hash => client.orderFilters.delete(hash));
    }

    if (resolvers && Array.isArray(resolvers)) {
      resolvers.forEach(resolver => client.resolverFilters.delete(resolver));
    }

    if (chainIds && Array.isArray(chainIds)) {
      chainIds.forEach(chainId => client.chainFilters.delete(chainId));
    }

    this.sendResponse(client, id, { unsubscribed: true });
  }

  /**
   * Handle event history requests
   */
  private handleGetEventHistory(client: WebSocketClient, id?: string, params?: any): void {
    const { limit = 100, offset = 0, events, orderHash } = params || {};

    let filteredHistory = Array.from(this.eventHistory);

    // Apply filters
    if (events && Array.isArray(events)) {
      filteredHistory = filteredHistory.filter(record => events.includes(record.event));
    }

    if (orderHash) {
      filteredHistory = filteredHistory.filter(record => record.orderHash === orderHash);
    }

    // Apply pagination
    const result = filteredHistory
      .slice(offset, offset + limit)
      .map(record => ({
        id: record.id,
        timestamp: record.timestamp,
        event: record.event,
        data: record.data
      }));

    this.sendResponse(client, id, {
      events: result,
      total: filteredHistory.length,
      limit,
      offset
    });
  }

  /**
   * Broadcast event to subscribed clients
   */
  broadcast(event: EventType, data: any, metadata?: { orderHash?: string; resolver?: string; chainId?: number }): void {
    const eventRecord: EventRecord = {
      id: generateUUID(),
      timestamp: Date.now(),
      event,
      data,
      orderHash: metadata?.orderHash,
      resolver: metadata?.resolver,
      chainId: metadata?.chainId
    };

    // Add to history
    this.eventHistory.push(eventRecord);
    if (this.eventHistory.length > this.MAX_HISTORY_SIZE) {
      this.eventHistory.shift();
    }

    const message: WebSocketMessage = {
      event,
      data: {
        ...data,
        timestamp: eventRecord.timestamp,
        eventId: eventRecord.id
      }
    };

    // Send to subscribed clients
    this.clients.forEach(client => {
      if (this.shouldSendToClient(client, event, metadata)) {
        this.sendMessage(client, message);
      }
    });

    console.log(`📡 Broadcasted ${event} to ${this.getSubscribedClientCount(event)} clients`);
  }

  /**
   * Check if event should be sent to client based on subscriptions and filters
   */
  private shouldSendToClient(client: WebSocketClient, event: EventType, metadata?: { orderHash?: string; resolver?: string; chainId?: number }): boolean {
    // Check event subscription
    if (!client.subscriptions.has(event)) {
      return false;
    }

    // Check order filter
    if (client.orderFilters.size > 0 && metadata?.orderHash && !client.orderFilters.has(metadata.orderHash)) {
      return false;
    }

    // Check resolver filter
    if (client.resolverFilters.size > 0 && metadata?.resolver && !client.resolverFilters.has(metadata.resolver)) {
      return false;
    }

    // Check chain filter
    if (client.chainFilters.size > 0 && metadata?.chainId && !client.chainFilters.has(metadata.chainId)) {
      return false;
    }

    return true;
  }

  /**
   * Get count of clients subscribed to an event
   */
  private getSubscribedClientCount(event: EventType): number {
    return Array.from(this.clients.values()).filter(client => client.subscriptions.has(event)).length;
  }

  /**
   * Send message to client. Every outbound frame — broadcast, RPC reply,
   * history replay, or error — goes through here and is redacted, so a
   * preimage, RPC userinfo, or auth header can never reach a socket.
   */
  private sendMessage(client: WebSocketClient, message: WebSocketMessage): void {
    if (client.socket.readyState === 1) { // 1 = OPEN
      client.socket.send(JSON.stringify(redactOutbound(message)));
    }
  }

  /**
   * Send RPC response to client
   */
  private sendResponse(client: WebSocketClient, id: string | undefined, result: any): void {
    this.sendMessage(client, { id, result });
  }

  /**
   * Send error to client
   */
  private sendError(client: WebSocketClient, code: number, message: string, data?: any): void {
    this.sendMessage(client, {
      error: { code, message }
    });
  }

  /**
   * Start the shared heartbeat sweep if it is not already running. The sweep
   * exists only while at least one client is connected, so an idle relayer
   * holds no timer at all.
   */
  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    // The sweep must not be the reason the process stays alive.
    this.heartbeatTimer.unref?.();
  }

  /** Stop the heartbeat sweep and drop its reference. Safe to call twice. */
  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * One heartbeat sweep: close clients whose last pong is older than the idle
   * timeout, then ping everyone still alive. Clients are copied first because
   * closing one mutates `clients`.
   */
  private heartbeat(): void {
    const now = Date.now();
    for (const client of [...this.clients.values()]) {
      if (now - client.lastPongAt >= this.idleTimeoutMs) {
        console.log(`💀 Closing unresponsive client after heartbeat timeout: ${client.id}`);
        this.closeIdleClient(client);
        continue;
      }
      try {
        client.socket.ping();
      } catch {
        // A socket that cannot be pinged is already gone.
        this.closeIdleClient(client);
      }
    }
  }

  /**
   * Remove an unresponsive client and close its socket with the stable
   * heartbeat code so the peer can distinguish an idle eviction from a
   * server shutdown (1001) or a policy refusal (1008).
   */
  private closeIdleClient(client: WebSocketClient): void {
    this.removeClient(client.id);
    try {
      client.socket.close(WS_HEARTBEAT_TIMEOUT_CODE, WS_HEARTBEAT_TIMEOUT_REASON);
    } catch {
      // The socket is already gone; removing the client is what matters.
    }
  }

  /** Unregister a client and stop the sweep once the last one disconnects. */
  private removeClient(id: string): void {
    if (!this.clients.delete(id)) return;
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  // Public getters for monitoring
  getClientCount(): number {
    return this.clients.size;
  }

  getEventHistorySize(): number {
    return this.eventHistory.length;
  }

  getClientInfo(): Array<{ id: string; subscriptions: string[]; filters: any; metadata: any }> {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      subscriptions: Array.from(client.subscriptions),
      filters: {
        orders: Array.from(client.orderFilters),
        resolvers: Array.from(client.resolverFilters),
        chains: Array.from(client.chainFilters)
      },
      metadata: client.metadata
    }));
  }
}

export default FusionWebSocketServer; 