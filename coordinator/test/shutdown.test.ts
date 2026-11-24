/**
 * Coordinator shutdown lifecycle test with fake resources — issue #505.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createShutdown,
  installShutdownHandlers,
  type ShutdownResources
} from "../src/shutdown.js";

function setup(overrides: Partial<ShutdownResources> & { serverClosesAfterMs?: number | null } = {}) {
  const events: string[] = [];
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const exit = vi.fn();
  const { serverClosesAfterMs = 0, ...rest } = overrides;

  const server = {
    close: vi.fn((cb: (err?: Error) => void) => {
      events.push("server.close");
      if (serverClosesAfterMs !== null) {
        setTimeout(() => {
          events.push("server.closed");
          cb();
        }, serverClosesAfterMs);
      }
    }),
    closeIdleConnections: vi.fn(() => events.push("server.closeIdleConnections")),
    closeAllConnections: vi.fn(() => events.push("server.closeAllConnections"))
  };
  const listeners = [
    { stop: vi.fn(() => void events.push("listener.eth.stop")) },
    { stop: vi.fn(() => void events.push("listener.soroban.stop")) }
  ];
  const closeDatabase = vi.fn(() => void events.push("database.close"));

  const shutdown = createShutdown({
    log,
    listeners,
    server,
    closeDatabase,
    deadlineMs: 200,
    exit,
    ...rest
  });
  return { shutdown, events, log, exit, server, listeners, closeDatabase };
}

describe("coordinator shutdown", () => {
  it("stops listeners, then HTTP, then closes the database, and exits 0", async () => {
    const { shutdown, events, exit } = setup();
    await expect(shutdown("SIGTERM")).resolves.toBe("clean");

    expect(events).toEqual([
      "listener.eth.stop",
      "listener.soroban.stop",
      "server.close",
      "server.closeIdleConnections",
      "server.closed",
      "database.close"
    ]);
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("does not close the database until in-flight HTTP requests have drained", async () => {
    const { shutdown, events, closeDatabase } = setup({ serverClosesAfterMs: 50 });
    const done = shutdown("SIGINT");
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain("server.close");
    expect(events).not.toContain("server.closed");
    expect(closeDatabase).not.toHaveBeenCalled();
    await done;
    expect(events.indexOf("server.closed")).toBeLessThan(events.indexOf("database.close"));
  });

  it("handles repeated signals once", async () => {
    const { shutdown, server, closeDatabase, exit, listeners, log } = setup();
    const first = shutdown("SIGTERM");
    const second = shutdown("SIGINT");
    const third = shutdown("SIGTERM");
    await Promise.all([first, second, third]);

    expect(server.close).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    for (const listener of listeners) expect(listener.stop).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith({ signal: "SIGINT" }, "shutdown already in progress");
  });

  it("gives up at the deadline, cuts connections, still closes the database and exits 1", async () => {
    const { shutdown, events, exit, log } = setup({ serverClosesAfterMs: null, deadlineMs: 30 });
    await expect(shutdown("SIGTERM")).resolves.toBe("deadline");

    expect(events).toEqual([
      "listener.eth.stop",
      "listener.soroban.stop",
      "server.close",
      "server.closeIdleConnections",
      "server.closeAllConnections",
      "database.close"
    ]);
    expect(log.warn).toHaveBeenCalledWith({ deadlineMs: 30 }, "shutdown deadline exceeded, closing connections");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps going when a listener fails to stop, and exits 1", async () => {
    const failing = { stop: vi.fn(() => { throw new Error("boom"); }) };
    const ok = { stop: vi.fn() };
    const { shutdown, server, closeDatabase, exit } = setup({ listeners: [failing, ok] });
    await expect(shutdown("SIGTERM")).resolves.toBe("failed");

    expect(ok.stop).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 when closing the database fails", async () => {
    const closeDatabase = vi.fn(() => { throw new Error("locked"); });
    const { shutdown, exit, log } = setup({ closeDatabase });
    await expect(shutdown("SIGTERM")).resolves.toBe("failed");
    expect(log.error).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the HTTP server reports a close error", async () => {
    const server = {
      close: vi.fn((cb: (err?: Error) => void) => cb(new Error("not running")))
    };
    const { shutdown, closeDatabase, exit } = setup({ server });
    await expect(shutdown("SIGTERM")).resolves.toBe("failed");
    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("installShutdownHandlers", () => {
  it("registers SIGINT and SIGTERM once and routes them to the shutdown routine", () => {
    const proc = new EventEmitter();
    const shutdown = vi.fn().mockResolvedValue("clean");
    installShutdownHandlers(proc as unknown as NodeJS.Process, shutdown);

    expect(proc.listenerCount("SIGINT")).toBe(1);
    expect(proc.listenerCount("SIGTERM")).toBe(1);

    proc.emit("SIGTERM");
    proc.emit("SIGTERM");
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith("SIGTERM");
    expect(proc.listenerCount("SIGTERM")).toBe(0);
  });
});
