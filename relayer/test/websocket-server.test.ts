import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  FusionWebSocketServer,
  EventType,
  WS_MESSAGE_TOO_BIG,
  WS_MESSAGE_TOO_BIG_REASON,
  WS_POLICY_VIOLATION,
  allowedOriginsFromEnv,
  inboundByteLength,
  isSocketOriginAllowed,
  maxMessageBytesFromEnv,
  parseMaxMessageBytes,
  redactOutbound
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
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
afterEach(() => {
  logSpy.mockClear();
  warnSpy.mockClear();
});

/** A valid `ping` RPC padded with ASCII to exactly `bytes` UTF-8 bytes. */
function pingOfSize(bytes: number): string {
  const base = JSON.stringify({ id: "1", method: "ping", pad: "" });
  const pad = bytes - Buffer.byteLength(base);
  if (pad < 0) throw new Error(`cannot build a ${bytes}-byte message`);
  const message = JSON.stringify({ id: "1", method: "ping", pad: "a".repeat(pad) });
  if (Buffer.byteLength(message) !== bytes) throw new Error("padding is not byte-exact");
  return message;
}

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

describe("FusionWebSocketServer inbound message size", () => {
  const LIMIT = 512;

  it("accepts a message exactly at the byte limit", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], LIMIT);
    const { socket } = connect(server, ALLOWED);

    socket.emit("message", pingOfSize(LIMIT));

    expect(socket.closed).toBeNull();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toMatchObject({ id: "1", result: "pong" });
    expect(server.getClientCount()).toBe(1);
  });

  it("closes a message one byte over the limit with the stable 1009 code", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], LIMIT);
    const { socket } = connect(server, ALLOWED);

    socket.emit("message", pingOfSize(LIMIT + 1));

    expect(socket.closed).toEqual({ code: WS_MESSAGE_TOO_BIG, reason: WS_MESSAGE_TOO_BIG_REASON });
    // Nothing was parsed or answered, and the client is already deregistered,
    // so a later broadcast cannot be queued behind the close frame.
    expect(socket.sent).toHaveLength(0);
    expect(server.getClientCount()).toBe(0);
    server.broadcast(EventType.OrderFilled, { orderHash: "0xorder1", status: "filled" });
    expect(socket.sent).toHaveLength(0);
  });

  it("measures UTF-8 bytes, not characters", () => {
    const multibyte = JSON.stringify({ id: "1", method: "ping", pad: "é".repeat(200) });
    const limit = Buffer.byteLength(multibyte) - 1;
    // A character-counting check would let this through.
    expect(multibyte.length).toBeLessThanOrEqual(limit);

    const server = new FusionWebSocketServer(0, [ALLOWED], limit);
    const { socket } = connect(server, ALLOWED);
    socket.emit("message", multibyte);

    expect(socket.closed?.code).toBe(WS_MESSAGE_TOO_BIG);
    expect(socket.sent).toHaveLength(0);
  });

  it("applies the same boundary to binary frames", () => {
    const server = new FusionWebSocketServer(0, [ALLOWED], 128);
    const { socket } = connect(server, ALLOWED);

    socket.emit("message", Buffer.alloc(129, 0x61));
    expect(socket.closed?.code).toBe(WS_MESSAGE_TOO_BIG);
    expect(socket.sent).toHaveLength(0);

    // Exactly at the limit passes the size gate; it fails later as bad JSON.
    const exactly = connect(server, ALLOWED);
    exactly.socket.emit("message", Buffer.alloc(128, 0x61));
    expect(exactly.socket.closed).toBeNull();
    expect(JSON.parse(exactly.socket.sent[0]).error.code).toBe(-32700);
  });

  it("logs the size and the limit but never the rejected body", () => {
    const marker = "SENSITIVE-PAYLOAD-MARKER";
    const server = new FusionWebSocketServer(0, [ALLOWED], 64);
    const { socket } = connect(server, ALLOWED);

    socket.emit("message", JSON.stringify({ id: "1", method: "ping", pad: marker.repeat(10) }));

    expect(socket.closed?.code).toBe(WS_MESSAGE_TOO_BIG);
    const logged = [...warnSpy.mock.calls, ...logSpy.mock.calls].map((args) => args.join(" "));
    expect(logged.some((line) => line.includes("exceeds the 64-byte limit"))).toBe(true);
    expect(logged.some((line) => line.includes(marker))).toBe(false);
  });
});

describe("FusionWebSocketServer inbound message configuration", () => {
  it("defaults to 64 KiB and reads the env override", () => {
    expect(DEFAULT_MAX_MESSAGE_BYTES).toBe(65_536);
    expect(maxMessageBytesFromEnv({})).toBe(DEFAULT_MAX_MESSAGE_BYTES);
    expect(maxMessageBytesFromEnv({ RELAYER_WS_MAX_MESSAGE_BYTES: "2048" })).toBe(2048);
    expect(parseMaxMessageBytes(undefined)).toBe(DEFAULT_MAX_MESSAGE_BYTES);
    expect(parseMaxMessageBytes(" 512 ")).toBe(512);
  });

  it("refuses an invalid limit instead of silently dropping the cap", () => {
    for (const raw of ["0", "-1", "1.5", "64k", " "]) {
      expect(() => maxMessageBytesFromEnv({ RELAYER_WS_MAX_MESSAGE_BYTES: raw })).toThrow(/RELAYER_WS_MAX_MESSAGE_BYTES/);
    }
    expect(() => new FusionWebSocketServer(0, [ALLOWED], 0)).toThrow();
  });

  it("counts UTF-8 bytes for strings and buffer length for binary frames", () => {
    expect(inboundByteLength("abc")).toBe(3);
    expect(inboundByteLength("é")).toBe(2);
    expect(inboundByteLength(Buffer.from([1, 2, 3]))).toBe(3);
    expect(inboundByteLength(new Uint8Array(5))).toBe(5);
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
