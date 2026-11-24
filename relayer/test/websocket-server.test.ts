import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FusionWebSocketServer,
  EventType,
  WS_POLICY_VIOLATION,
  allowedOriginsFromEnv,
  isSocketOriginAllowed,
  redactOutbound,
  DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION,
  getMaxSubscriptionsPerConnection,
} from "../src/websocket-server.js";

// No server is started: sockets are in-memory fakes, so no port is bound.

const ALLOWED = "https://app.oversync.example";
const FOREIGN = "https://evil.example";
const PREIMAGE = "0x" + "ab".repeat(32);

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private handlers = new Map<string, (...args: any[]) => void>();
  send(data: string) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; this.readyState = 3; }
  terminate() { this.readyState = 3; }
  ping() {}
  on(event: string, cb: (...args: any[]) => void) { this.handlers.set(event, cb); }
  emit(event: string, ...args: any[]) { this.handlers.get(event)?.(...args); }
}

function connect(server: FusionWebSocketServer, origin?: string) {
  const socket = new FakeSocket();
  const headers: Record<string, string> = origin ? { origin } : {};
  const client = server.handleConnection(socket as any, { headers });
  return { socket, client };
}

function subscribe(socket: FakeSocket) {
  socket.emit("message", JSON.stringify({ id: "1", method: "subscribe", params: { events: Object.values(EventType) } }));
  socket.sent.length = 0;
}

const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
afterEach(() => logSpy.mockClear());

describe("FusionWebSocketServer origin policy", () => {
  it("lets an allowed origin receive an order status", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();
    subscribe(socket);

    server.broadcast(EventType.OrderFilled, { orderHash: "0xorder1", status: "filled" }, { orderHash: "0xorder1" });

    expect(socket.sent).toHaveLength(1);
    const msg = JSON.parse(socket.sent[0]);
    expect(msg.data).toMatchObject({ orderHash: "0xorder1", status: "filled" });
  });

  it("closes a foreign origin before any order message", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    const { socket, client } = connect(server, FOREIGN);
    expect(client).toBeNull();
    expect(socket.closed?.code).toBe(WS_POLICY_VIOLATION);
    expect(server.getClientCount()).toBe(0);

    server.broadcast(EventType.OrderFilled, { orderHash: "0xorder1", status: "filled" });
    expect(socket.sent).toHaveLength(0);
  });

  it("closes a connection with no Origin header", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    const { socket, client } = connect(server);
    expect(client).toBeNull();
    expect(socket.closed?.code).toBe(WS_POLICY_VIOLATION);
    expect(socket.sent).toHaveLength(0);
  });

  it("uses the coordinator CORS env vars and rejects a missing origin", () => {
    expect(allowedOriginsFromEnv({ COORDINATOR_CORS_ORIGINS: ALLOWED })).toEqual([ALLOWED]);
    expect(allowedOriginsFromEnv({})).toContain("http://localhost:5173");
    expect(isSocketOriginAllowed(undefined, ["*"])).toBe(false);
  });
});

describe("FusionWebSocketServer outbound redaction", () => {
  it("strips a fixture preimage from a broadcast but keeps order id and status", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    const { socket } = connect(server, ALLOWED);
    subscribe(socket);

    server.broadcast(
      EventType.SecretShared,
      { orderHash: "0xorder2", status: "secret_revealed", secret: PREIMAGE, preimage: PREIMAGE, secretIndex: 0 },
      { orderHash: "0xorder2" }
    );

    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).not.toContain(PREIMAGE);
    expect(socket.sent[0]).not.toContain("ab".repeat(32));
    expect(JSON.parse(socket.sent[0]).data).toMatchObject({ orderHash: "0xorder2", status: "secret_revealed" });
  });

  it("applies the same redaction to a direct reply (event history)", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    server.broadcast(EventType.SecretShared, { orderHash: "0xorder3", status: "secret_revealed", secret: PREIMAGE });

    const { socket } = connect(server, ALLOWED);
    socket.emit("message", JSON.stringify({ id: "7", method: "getEventHistory", params: {} }));

    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).not.toContain(PREIMAGE);
    const reply = JSON.parse(socket.sent[0]);
    expect(reply.result.events[0].data).toMatchObject({ orderHash: "0xorder3", status: "secret_revealed" });
  });

  it("strips RPC userinfo and authorization headers", () => {
    const out = redactOutbound({
      orderId: "ord_1",
      status: "claimed",
      rpcUrl: "https://user:s3cret@rpc.example/v2/key",
      headers: { Authorization: "Bearer tok", "content-type": "application/json" },
      nested: [{ preimage: PREIMAGE, orderId: "ord_2" }]
    });
    expect(JSON.stringify(out)).not.toMatch(/s3cret|Bearer tok|user:/);
    expect(JSON.stringify(out)).not.toContain(PREIMAGE);
    expect(out).toMatchObject({
      orderId: "ord_1",
      status: "claimed",
      rpcUrl: "https://rpc.example/v2/key",
      headers: { "content-type": "application/json" },
      nested: [{ orderId: "ord_2" }]
    });
  });
});

describe("FusionWebSocketServer subscription limits", () => {
  it("enforces the default subscription limit per connection", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 10);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    // Subscribe to 8 events (within limit)
    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 8)
      }
    }));

    expect(socket.sent).toHaveLength(1);
    let reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(8);
    expect(reply.result.limit).toBe(10);
    socket.sent.length = 0;

    // Add 2 order filters (at limit: 8 + 2 = 10)
    socket.emit("message", JSON.stringify({
      id: "2",
      method: "subscribe",
      params: {
        orderHashes: ["0xorder1", "0xorder2"]
      }
    }));

    expect(socket.sent).toHaveLength(1);
    reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(10);
    socket.sent.length = 0;

    // Try to add 1 more (should be rejected: 10 + 1 = 11 > 10)
    socket.emit("message", JSON.stringify({
      id: "3",
      method: "subscribe",
      params: {
        chainIds: [1]
      }
    }));

    expect(socket.sent).toHaveLength(1);
    reply = JSON.parse(socket.sent[0]);
    expect(reply.error).toBeDefined();
    expect(reply.error.code).toBe(-32000);
    expect(reply.error.message).toBe("Subscription limit exceeded");
    expect(reply.error.data.current).toBe(10);
    expect(reply.error.data.requested).toBe(1);
    expect(reply.error.data.limit).toBe(10);
  });

  it("releases subscription count on unsubscribe", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 5);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    // Subscribe to 5 events (at limit)
    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 5)
      }
    }));

    let reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscriptionCount).toBe(5);
    socket.sent.length = 0;

    // Unsubscribe from 2 events
    socket.emit("message", JSON.stringify({
      id: "2",
      method: "unsubscribe",
      params: {
        events: Object.values(EventType).slice(0, 2)
      }
    }));

    reply = JSON.parse(socket.sent[0]);
    expect(reply.result.unsubscribed).toBe(true);
    expect(reply.result.removed).toBe(2);
    expect(reply.result.subscriptionCount).toBe(3);
    socket.sent.length = 0;

    // Now can subscribe to 2 more
    socket.emit("message", JSON.stringify({
      id: "3",
      method: "subscribe",
      params: {
        orderHashes: ["0xorder1", "0xorder2"]
      }
    }));

    reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(5);
  });

  it("releases subscription count on disconnect", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 10);
    const { socket: socket1, client: client1 } = connect(server, ALLOWED);
    expect(client1).not.toBeNull();

    // Client 1 subscribes to 8 items
    socket1.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 8)
      }
    }));

    let reply = JSON.parse(socket1.sent[0]);
    expect(reply.result.subscriptionCount).toBe(8);

    // Client 1 disconnects
    socket1.emit("close");

    expect(server.getClientCount()).toBe(0);

    // New client can now connect and use subscriptions
    const { socket: socket2, client: client2 } = connect(server, ALLOWED);
    expect(client2).not.toBeNull();

    socket2.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 10)
      }
    }));

    reply = JSON.parse(socket2.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(10);
  });

  it("counts all subscription types toward the limit", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 10);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    // Subscribe to a mix: 3 events + 3 orders + 2 resolvers + 2 chains = 10
    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 3),
        orderHashes: ["0xorder1", "0xorder2", "0xorder3"],
        resolvers: ["0xresolver1", "0xresolver2"],
        chainIds: [1, 11155111]
      }
    }));

    expect(socket.sent).toHaveLength(1);
    const reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(10);
    expect(reply.result.events).toHaveLength(3);
    expect(reply.result.filters.orders).toHaveLength(3);
    expect(reply.result.filters.resolvers).toHaveLength(2);
    expect(reply.result.filters.chains).toHaveLength(2);
  });

  it("does not count duplicate subscriptions toward the limit", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 5);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    // Subscribe to 3 events
    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 3)
      }
    }));

    let reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscriptionCount).toBe(3);
    socket.sent.length = 0;

    // Try to subscribe to same 3 events again (should not increase count)
    socket.emit("message", JSON.stringify({
      id: "2",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 3)
      }
    }));

    reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(3); // Still 3, not 6
  });

  it("allows exactly the limit subscriptions", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 3);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 3)
      }
    }));

    const reply = JSON.parse(socket.sent[0]);
    expect(reply.result.subscribed).toBe(true);
    expect(reply.result.subscriptionCount).toBe(3);
    expect(reply.error).toBeUndefined();
  });

  it("rejects when adding multiple items that would exceed limit", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 5);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    // Subscribe to 3 events
    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: Object.values(EventType).slice(0, 3)
      }
    }));

    expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(3);
    socket.sent.length = 0;

    // Try to add 5 order hashes (3 + 5 = 8 > 5 limit)
    socket.emit("message", JSON.stringify({
      id: "2",
      method: "subscribe",
      params: {
        orderHashes: ["0xa", "0xb", "0xc", "0xd", "0xe"]
      }
    }));

    const reply = JSON.parse(socket.sent[0]);
    expect(reply.error).toBeDefined();
    expect(reply.error.code).toBe(-32000);
    expect(reply.error.data.current).toBe(3);
    expect(reply.error.data.requested).toBe(5);
  });

  it("uses default limit when not specified", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED]);
    const { socket, client } = connect(server, ALLOWED);
    expect(client).not.toBeNull();

    socket.emit("message", JSON.stringify({
      id: "1",
      method: "subscribe",
      params: {
        events: [EventType.OrderCreated]
      }
    }));

    const reply = JSON.parse(socket.sent[0]);
    expect(reply.result.limit).toBe(DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION);
  });

  it("parses limit from environment variable", () => {
    expect(getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "500" })).toBe(500);
    expect(getMaxSubscriptionsPerConnection({})).toBe(DEFAULT_MAX_SUBSCRIPTIONS_PER_CONNECTION);
  });

  it("throws on invalid environment variable", () => {
    expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "invalid" }))
      .toThrow(/Invalid WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION/);
    expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "0" }))
      .toThrow(/Must be a positive integer/);
    expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "-10" }))
      .toThrow(/Must be a positive integer/);
  });
});
