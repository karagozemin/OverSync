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
  validateSubscriptionLimit,
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

  describe("duplicate subscription handling", () => {
    it("ignores duplicate event subscriptions", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe to same event multiple times in one request
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: [EventType.OrderCreated, EventType.OrderCreated, EventType.OrderFilled]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscriptionCount).toBe(2); // Only 2 unique events
      expect(reply.result.events).toHaveLength(2);
    });

    it("ignores duplicate order hash filters", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe with duplicate order hashes
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: [EventType.OrderCreated],
          orderHashes: ["0xorder1", "0xorder1", "0xorder2"]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscriptionCount).toBe(3); // 1 event + 2 unique orders
      expect(reply.result.filters.orders).toHaveLength(2);
    });

    it("ignores duplicate resolver filters", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: [EventType.OrderFilled],
          resolvers: ["0xabc", "0xabc", "0xdef", "0xdef"]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscriptionCount).toBe(3); // 1 event + 2 unique resolvers
      expect(reply.result.filters.resolvers).toHaveLength(2);
    });

    it("ignores duplicate chain ID filters", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: [EventType.OrderCreated],
          chainIds: [1, 1, 11155111, 11155111, 1]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscriptionCount).toBe(3); // 1 event + 2 unique chains
      expect(reply.result.filters.chains).toHaveLength(2);
    });

    it("ignores duplicates when resubscribing", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // First subscription
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: [EventType.OrderCreated, EventType.OrderFilled],
          orderHashes: ["0xorder1"]
        }
      }));

      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(3);
      socket.sent.length = 0;

      // Second subscription with overlapping items
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "subscribe",
        params: {
          events: [EventType.OrderFilled, EventType.OrderCancelled], // OrderFilled is duplicate
          orderHashes: ["0xorder1", "0xorder2"] // 0xorder1 is duplicate
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscriptionCount).toBe(5); // 3 events + 2 orders (only +2 new)
      expect(reply.result.subscribed).toBe(true);
    });
  });

  describe("capacity release on unsubscribe", () => {
    it("releases capacity for each filter type on unsubscribe", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 20);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe to multiple types
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: Object.values(EventType).slice(0, 5),
          orderHashes: ["0xa", "0xb", "0xc"],
          resolvers: ["0x1", "0x2"],
          chainIds: [1, 11155111, 137]
        }
      }));

      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(13); // 5+3+2+3
      socket.sent.length = 0;

      // Unsubscribe from some of each type
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "unsubscribe",
        params: {
          events: Object.values(EventType).slice(0, 2),
          orderHashes: ["0xb"],
          resolvers: ["0x2"],
          chainIds: [137]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.removed).toBe(5); // 2 events + 1 order + 1 resolver + 1 chain
      expect(reply.result.subscriptionCount).toBe(8); // 13 - 5
    });

    it("allows immediate resubscription after unsubscribe", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 5);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Fill to capacity
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { orderHashes: ["0xa", "0xb", "0xc", "0xd", "0xe"] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(5);
      socket.sent.length = 0;

      // Unsubscribe 3
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "unsubscribe",
        params: { orderHashes: ["0xa", "0xb", "0xc"] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(2);
      socket.sent.length = 0;

      // Immediately subscribe to 3 new ones
      socket.emit("message", JSON.stringify({
        id: "3",
        method: "subscribe",
        params: { orderHashes: ["0xf", "0xg", "0xh"] }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscribed).toBe(true);
      expect(reply.result.subscriptionCount).toBe(5);
      expect(reply.error).toBeUndefined();
    });

    it("handles unsubscribing from non-existent items gracefully", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe to some items
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: [EventType.OrderCreated] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(1);
      socket.sent.length = 0;

      // Unsubscribe from items that were never subscribed
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "unsubscribe",
        params: {
          events: [EventType.OrderFilled], // Not subscribed
          orderHashes: ["0xnever"] // Not subscribed
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.unsubscribed).toBe(true);
      expect(reply.result.removed).toBe(0);
      expect(reply.result.subscriptionCount).toBe(1); // Unchanged
    });
  });

  describe("capacity release on disconnect", () => {
    it("fully releases capacity when client disconnects", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 15);
      const { socket: s1, client: c1 } = connect(server, ALLOWED);
      expect(c1).not.toBeNull();

      // Client 1 uses 10 subscriptions
      s1.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: Object.values(EventType).slice(0, 6),
          orderHashes: ["0xa", "0xb"],
          chainIds: [1, 137]
        }
      }));

      expect(JSON.parse(s1.sent[0]).result.subscriptionCount).toBe(10);
      expect(server.getClientCount()).toBe(1);

      // Disconnect client 1
      s1.emit("close");
      expect(server.getClientCount()).toBe(0);

      // New client should have full capacity available
      const { socket: s2, client: c2 } = connect(server, ALLOWED);
      expect(c2).not.toBeNull();

      s2.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { orderHashes: Array.from({ length: 15 }, (_, i) => `0x${i}`) }
      }));

      const reply = JSON.parse(s2.sent[0]);
      expect(reply.result.subscribed).toBe(true);
      expect(reply.result.subscriptionCount).toBe(15);
      expect(reply.error).toBeUndefined();
    });

    it("releases capacity for multiple disconnecting clients independently", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      
      // Connect 3 clients
      const { socket: s1, client: c1 } = connect(server, ALLOWED);
      const { socket: s2, client: c2 } = connect(server, ALLOWED);
      const { socket: s3, client: c3 } = connect(server, ALLOWED);

      // Each client subscribes to different amounts
      s1.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 5) }
      }));
      s2.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 3) }
      }));
      s3.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 7) }
      }));

      expect(server.getClientCount()).toBe(3);

      // Disconnect client 2 (middle one)
      s2.emit("close");
      expect(server.getClientCount()).toBe(2);

      // Clients 1 and 3 should still be connected with their subscriptions
      const clientsInfo = server.getClientInfo();
      expect(clientsInfo).toHaveLength(2);
      expect(clientsInfo[0].subscriptions).toHaveLength(5);
      expect(clientsInfo[1].subscriptions).toHaveLength(7);
    });

    it("logs subscription release count on disconnect", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe to 7 items
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: Object.values(EventType).slice(0, 5),
          orderHashes: ["0xa", "0xb"]
        }
      }));

      logSpy.mockClear();
      socket.emit("close");

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Client .+ disconnected: released 7 subscription\(s\)/)
      );
    });

    it("does not log on disconnect if client had no subscriptions", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Don't subscribe to anything
      logSpy.mockClear();
      socket.emit("close");

      // Should not log release message
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/released.*subscription/)
      );
    });
  });

  describe("shared limit across filter types", () => {
    it("respects shared limit across all filter types", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Add 3 events
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 3) }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(3);
      socket.sent.length = 0;

      // Add 3 order filters
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "subscribe",
        params: { orderHashes: ["0xa", "0xb", "0xc"] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(6);
      socket.sent.length = 0;

      // Add 2 resolver filters
      socket.emit("message", JSON.stringify({
        id: "3",
        method: "subscribe",
        params: { resolvers: ["0x1", "0x2"] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(8);
      socket.sent.length = 0;

      // Add 2 chain filters (at limit: 3+3+2+2=10)
      socket.emit("message", JSON.stringify({
        id: "4",
        method: "subscribe",
        params: { chainIds: [1, 11155111] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(10);
      socket.sent.length = 0;

      // Try to add 1 more of ANY type - should be rejected
      socket.emit("message", JSON.stringify({
        id: "5",
        method: "subscribe",
        params: { events: [EventType.OrderCancelled] }
      }));

      let reply = JSON.parse(socket.sent[0]);
      expect(reply.error).toBeDefined();
      expect(reply.error.code).toBe(-32000);
      socket.sent.length = 0;

      // Try to add order filter - also rejected
      socket.emit("message", JSON.stringify({
        id: "6",
        method: "subscribe",
        params: { orderHashes: ["0xnew"] }
      }));

      reply = JSON.parse(socket.sent[0]);
      expect(reply.error).toBeDefined();
      expect(reply.error.code).toBe(-32000);
    });

    it("allows mixed filter types up to exactly the limit", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 12);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Subscribe to exactly 12 items mixed across all types
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: {
          events: Object.values(EventType).slice(0, 4),     // 4
          orderHashes: ["0xa", "0xb", "0xc"],               // 3
          resolvers: ["0x1", "0x2"],                        // 2
          chainIds: [1, 11155111, 137]                      // 3
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscribed).toBe(true);
      expect(reply.result.subscriptionCount).toBe(12);
      expect(reply.error).toBeUndefined();
    });

    it("enforces limit when mixing subscriptions across multiple requests", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 8);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Request 1: 3 events
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 3) }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(3);
      socket.sent.length = 0;

      // Request 2: 2 orders
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "subscribe",
        params: { orderHashes: ["0xa", "0xb"] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(5);
      socket.sent.length = 0;

      // Request 3: 3 chains (total 8, at limit)
      socket.emit("message", JSON.stringify({
        id: "3",
        method: "subscribe",
        params: { chainIds: [1, 137, 11155111] }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(8);
      socket.sent.length = 0;

      // Request 4: 1 resolver (would exceed)
      socket.emit("message", JSON.stringify({
        id: "4",
        method: "subscribe",
        params: { resolvers: ["0x1"] }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.error).toBeDefined();
      expect(reply.error.code).toBe(-32000);
      expect(reply.error.data.current).toBe(8);
      expect(reply.error.data.limit).toBe(8);
    });

    it("allows adding to different filter types after partial unsubscribe", () => {
      const server = new FusionWebSocketServer(0, [ALLOWED], 10);
      const { socket, client } = connect(server, ALLOWED);
      expect(client).not.toBeNull();

      // Fill to capacity with events only
      socket.emit("message", JSON.stringify({
        id: "1",
        method: "subscribe",
        params: { events: Object.values(EventType).slice(0, 10) }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(10);
      socket.sent.length = 0;

      // Unsubscribe from 4 events
      socket.emit("message", JSON.stringify({
        id: "2",
        method: "unsubscribe",
        params: { events: Object.values(EventType).slice(0, 4) }
      }));
      expect(JSON.parse(socket.sent[0]).result.subscriptionCount).toBe(6);
      socket.sent.length = 0;

      // Now add 4 items of different types
      socket.emit("message", JSON.stringify({
        id: "3",
        method: "subscribe",
        params: {
          orderHashes: ["0xa", "0xb"],
          resolvers: ["0x1"],
          chainIds: [1]
        }
      }));

      const reply = JSON.parse(socket.sent[0]);
      expect(reply.result.subscribed).toBe(true);
      expect(reply.result.subscriptionCount).toBe(10);
      expect(reply.error).toBeUndefined();
    });
  });

  describe("limit validation", () => {
    it("validates constructor limit as positive integer", () => {
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 0))
        .toThrow(/must be a positive integer/);
      expect(() => new FusionWebSocketServer(0, [ALLOWED], -5))
        .toThrow(/must be a positive integer/);
    });

    it("validates constructor limit as whole integer", () => {
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 10.5))
        .toThrow(/must be a whole integer/);
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 3.14159))
        .toThrow(/must be a whole integer/);
    });

    it("rejects non-numeric constructor limit", () => {
      expect(() => new FusionWebSocketServer(0, [ALLOWED], NaN))
        .toThrow(/not a valid number/);
      expect(() => new FusionWebSocketServer(0, [ALLOWED], "abc" as any))
        .toThrow(/not a valid number/);
    });

    it("validates environment limit as positive integer", () => {
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "0" }))
        .toThrow(/must be a positive integer/);
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "-100" }))
        .toThrow(/must be a positive integer/);
    });

    it("validates environment limit as whole integer", () => {
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "10.5" }))
        .toThrow(/must be a whole integer/);
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "99.999" }))
        .toThrow(/must be a whole integer/);
    });

    it("rejects exceeds safe integer bounds", () => {
      const tooLarge = (Number.MAX_SAFE_INTEGER + 1).toString();
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: tooLarge }))
        .toThrow(/exceeds safe integer bounds/);
    });

    it("rejects unreasonably large values", () => {
      expect(() => getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "10000000" }))
        .toThrow(/exceeds reasonable limit/);
    });

    it("accepts valid integer limits", () => {
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 1)).not.toThrow();
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 100)).not.toThrow();
      expect(() => new FusionWebSocketServer(0, [ALLOWED], 10000)).not.toThrow();
      
      expect(getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "1" })).toBe(1);
      expect(getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "500" })).toBe(500);
      expect(getMaxSubscriptionsPerConnection({ WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION: "999999" })).toBe(999999);
    });
  });
});
