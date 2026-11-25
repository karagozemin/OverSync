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
 * WebSocket close code for an inbound message larger than the configured
 * limit (RFC 6455 §7.4.1 "Message Too Big"). Stable so clients can tell an
 * oversized frame apart from an origin/policy refusal (1008).
 */
export const WS_MESSAGE_TOO_BIG = 1009;

/**
 * Default maximum size in bytes of a single inbound WebSocket message.
 * 64 KiB matches the coordinator's `COORDINATOR_MAX_BODY_BYTES` ceiling.
 * Override with `RELAYER_WS_MAX_MESSAGE_BYTES`.
 *
 * The cap is enforced on the raw frame before it is buffered into a string
 * or parsed as JSON, so an authenticated or allowlisted client cannot make
 * the relayer hold an arbitrarily large message.
 */
export const DEFAULT_MAX_MESSAGE_BYTES = 65_536;

/** Close reason sent with `WS_MESSAGE_TOO_BIG`; contains no message content. */
export const WS_MESSAGE_TOO_BIG_REASON = 'message too big';

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
// Inbound message size limit
// ---------------------------------------------------------------------------

/**
 * Validate a configured inbound byte cap. A malformed or blank value throws
 * instead of silently disabling the limit, mirroring the coordinator's
 * config validation. Only an unset variable falls back to the default.
 */
export function parseMaxMessageBytes(raw: string | number | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_MESSAGE_BYTES;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) {
      throw new Error(`Invalid max message size: expected a positive integer, got ${raw}.`);
    }
    return raw;
  }
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid RELAYER_WS_MAX_MESSAGE_BYTES: expected a positive integer, got "${raw}".`);
  }
  return value;
}

/** Read the inbound message cap from `RELAYER_WS_MAX_MESSAGE_BYTES`. */
export function maxMessageBytesFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return parseMaxMessageBytes(env.RELAYER_WS_MAX_MESSAGE_BYTES);
}

/**
 * Byte length of one inbound frame as it arrived. Strings are measured as
 * UTF-8 (not characters) and binary frames by their buffer, so a multi-byte
 * or binary payload cannot slip past the cap.
 */
export function inboundByteLength(raw: unknown): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8');
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (ArrayBuffer.isView(raw)) return raw.byteLength;
  if (Array.isArray(raw)) {
    return raw.reduce<number>((total, part) => total + inboundByteLength(part), 0);
  }
  return Buffer.byteLength(String(raw), 'utf8');
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
  lastPing: number;
  isAlive: boolean;
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
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly PING_INTERVAL = 30000; // 30 seconds
  private isRunning = false;
  private readonly allowedOrigins: string[];
  private readonly maxMessageBytes: number;

  constructor(
    private port: number = 3002,
    allowedOrigins: string[] = allowedOriginsFromEnv(),
    maxMessageBytes: number = maxMessageBytesFromEnv()
  ) {
    super();
    this.httpServer = createServer();
    this.allowedOrigins = allowedOrigins;
    this.maxMessageBytes = parseMaxMessageBytes(maxMessageBytes);
  }

  /**
   * Admit a new socket. The connection is closed with 1008 before it is
   * registered (and therefore before any order message) when the Origin
   * header is missing or not on the coordinator CORS allowlist. A frame
   * larger than `maxMessageBytes` closes the connection with 1009 before it
   * is decoded or parsed, and only its size is logged.
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
      lastPing: Date.now(),
      isAlive: true,
      metadata: {
        userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
        ip: request.socket?.remoteAddress,
        connectedAt: Date.now()
      }
    };
    this.clients.set(client.id, client);

    socket.on('message', (raw: unknown) => {
      // Measure the frame before turning it into a string: the size cap must
      // apply to what actually arrived, not to a decoded copy of it.
      const bytes = inboundByteLength(raw);
      if (bytes > this.maxMessageBytes) {
        // Only the size and the limit are logged — never the rejected body.
        console.warn(
          `🛑 Closing client ${client.id}: inbound message of ${bytes} bytes exceeds the ${this.maxMessageBytes}-byte limit`
        );
        // Drop the client first so no broadcast can be queued behind the
        // close frame while the handshake is still in flight.
        this.clients.delete(client.id);
        socket.close(WS_MESSAGE_TOO_BIG, WS_MESSAGE_TOO_BIG_REASON);
        return;
      }

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
      client.isAlive = true;
      client.lastPing = Date.now();
    });
    socket.on('close', () => {
      this.clients.delete(client.id);
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
          this.startPingInterval();
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
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

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
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      this.clients.forEach(client => {
        if (!client.isAlive) {
          console.log(`💀 Terminating inactive client: ${client.id}`);
          client.socket.terminate();
          this.clients.delete(client.id);
          return;
        }

        client.isAlive = false;
        client.socket.ping();
      });
    }, this.PING_INTERVAL);
  }

  // Public getters for monitoring
  getClientCount(): number {
    return this.clients.size;
  }

  getEventHistorySize(): number {
    return this.eventHistory.length;
  }

  /** Effective inbound message cap, in bytes. */
  getMaxMessageBytes(): number {
    return this.maxMessageBytes;
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