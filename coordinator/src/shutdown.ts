/**
 * Graceful coordinator shutdown (#505).
 *
 * On the first SIGTERM or SIGINT the coordinator:
 *   1. stops the chain listeners, so no new order transitions are started,
 *   2. stops accepting HTTP connections and waits for in-flight requests,
 *   3. only then closes persistence resources.
 * The whole sequence is bounded by a deadline. When it is exceeded the remaining
 * connections are cut, the database is still closed, and the process exits with
 * a failure code instead of hanging a deploy restart.
 */

export interface ShutdownLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface ShutdownServer {
  close(callback: (err?: Error) => void): unknown;
  /** Present on Node's http.Server; frees idle keep-alive sockets so close() can finish. */
  closeIdleConnections?(): void;
  /** Present on Node's http.Server; used only once the deadline has passed. */
  closeAllConnections?(): void;
}

export interface ShutdownResources {
  log: ShutdownLogger;
  /** Chain listeners (or anything else that feeds order transitions). */
  listeners: Array<{ stop(): void | Promise<void> }>;
  server: ShutdownServer;
  /** Closes the database; called after the HTTP server has drained. */
  closeDatabase(): void | Promise<void>;
  /** Upper bound for the whole sequence, in milliseconds. */
  deadlineMs: number;
  exit(code: number): void;
}

export type ShutdownOutcome = "clean" | "failed" | "deadline";

/**
 * Build the shutdown routine. It runs at most once: later calls (a second
 * signal, or the same signal delivered twice) resolve to the first outcome.
 */
export function createShutdown(res: ShutdownResources): (signal: string) => Promise<ShutdownOutcome> {
  let running: Promise<ShutdownOutcome> | null = null;

  const closeDatabase = async (): Promise<boolean> => {
    try {
      await res.closeDatabase();
      return true;
    } catch (err) {
      res.log.error({ err }, "closing the database failed");
      return false;
    }
  };

  const drain = async (): Promise<boolean> => {
    let ok = true;

    for (const listener of res.listeners) {
      try {
        await listener.stop();
      } catch (err) {
        ok = false;
        res.log.error({ err }, "stopping a listener failed");
      }
    }

    // New HTTP requests are refused from here on; in-flight ones finish.
    await new Promise<void>((resolve) => {
      res.server.close((err) => {
        if (err) {
          ok = false;
          res.log.error({ err }, "closing the HTTP server failed");
        }
        resolve();
      });
      res.server.closeIdleConnections?.();
    });

    return (await closeDatabase()) && ok;
  };

  const run = async (signal: string): Promise<ShutdownOutcome> => {
    res.log.info({ signal, deadlineMs: res.deadlineMs }, "shutting down");

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimeout(() => resolve("deadline"), res.deadlineMs);
      timer.unref?.();
    });

    const result = await Promise.race([drain(), deadline]);
    if (timer) clearTimeout(timer);

    if (result === "deadline") {
      res.log.warn({ deadlineMs: res.deadlineMs }, "shutdown deadline exceeded, closing connections");
      res.server.closeAllConnections?.();
      await closeDatabase();
      res.exit(1);
      return "deadline";
    }

    res.log.info({ clean: result }, "shutdown complete");
    res.exit(result ? 0 : 1);
    return result ? "clean" : "failed";
  };

  return (signal: string) => {
    if (running) {
      res.log.info({ signal }, "shutdown already in progress");
      return running;
    }
    running = run(signal);
    return running;
  };
}

/** Register the shutdown routine for SIGINT and SIGTERM, once each. */
export function installShutdownHandlers(
  proc: Pick<NodeJS.Process, "once">,
  shutdown: (signal: string) => Promise<unknown>
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    proc.once(signal, () => void shutdown(signal));
  }
}
