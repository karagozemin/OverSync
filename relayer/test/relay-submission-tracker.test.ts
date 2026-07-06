import { describe, it, expect, vi } from "vitest";
import {
  RelaySubmissionTracker,
  RelayTerminalError,
  RelayInFlightError,
  RelayTimeoutError,
  computeFingerprint,
  type RelayAction,
  type RelayTrackerEvent,
} from "../src/relay-submission-tracker.js";

const action = (over: Partial<RelayAction> = {}): RelayAction => ({
  kind: "eth->xlm",
  orderId: "order_123",
  chain: "stellar",
  destination: "GUSER...",
  amount: "10.0000000",
  ...over,
});

// No-op sleep so retry delays don't slow the suite down.
const noSleep = () => Promise.resolve();

describe("computeFingerprint", () => {
  it("is deterministic and independent of extra-field ordering", () => {
    const a = action({ extra: { a: 1, b: 2 } });
    const b = action({ extra: { b: 2, a: 1 } });
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it("differs when a material field differs", () => {
    expect(computeFingerprint(action())).not.toBe(
      computeFingerprint(action({ amount: "11.0000000" }))
    );
    expect(computeFingerprint(action())).not.toBe(
      computeFingerprint(action({ orderId: "order_999" }))
    );
  });
});

describe("successful relay (happy path is preserved)", () => {
  it("runs the executor once and returns its result", async () => {
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const executor = vi.fn().mockResolvedValue({ hash: "abc" });

    const outcome = await tracker.submit(action(), executor);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("succeeded");
    expect(outcome.duplicate).toBe(false);
    expect(outcome.result).toEqual({ hash: "abc" });
    expect(tracker.getRecord(action())?.status).toBe("succeeded");
  });
});

describe("timeout retry", () => {
  it("retries a timed-out attempt and can still succeed within budget", async () => {
    const events: RelayTrackerEvent[] = [];
    const tracker = new RelaySubmissionTracker({
      maxAttempts: 3,
      timeoutMs: 10,
      sleep: noSleep,
      onEvent: (e) => events.push(e),
    });

    // First attempt never resolves -> hits the per-attempt timeout.
    // Second attempt resolves immediately.
    const executor = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({ hash: "ok" });

    const outcome = await tracker.submit(action(), executor);

    expect(executor).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("succeeded");
    const record = tracker.getRecord(action());
    expect(record?.attempts).toBe(2);
    expect(events.map((e) => e.type)).toContain("retry");
    // The timeout surfaced as the last error before recovery.
    expect(events.find((e) => e.type === "retry")?.error).toMatch(/timed out/i);
  });

  it("bounds retries so a perpetually timing-out relay cannot submit forever", async () => {
    const tracker = new RelaySubmissionTracker({
      maxAttempts: 3,
      timeoutMs: 10,
      sleep: noSleep,
    });
    // Always hangs -> always times out.
    const executor = vi.fn().mockImplementation(() => new Promise(() => {}));

    await expect(tracker.submit(action(), executor)).rejects.toBeInstanceOf(
      RelayTerminalError
    );
    // Exactly the budget, never more.
    expect(executor).toHaveBeenCalledTimes(3);
    const record = tracker.getRecord(action());
    expect(record?.status).toBe("failed");
    expect(record?.attempts).toBe(3);
    expect(record?.lastError).toMatch(/timed out/i);
  });
});

describe("duplicate prevention", () => {
  it("does not re-run the executor for an already-handled action", async () => {
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const executor = vi.fn().mockResolvedValue({ hash: "first" });

    const first = await tracker.submit(action(), executor);
    const second = await tracker.submit(action(), executor);

    expect(executor).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("already_handled");
    expect(second.duplicate).toBe(true);
    expect(second.result).toEqual({ hash: "first" });
    expect(tracker.getStats().duplicatesSkipped).toBe(1);
  });

  it("rejects a concurrent in-flight submission for the same key", async () => {
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    let release!: (v: { hash: string }) => void;
    const executor = vi
      .fn()
      .mockImplementation(() => new Promise((r) => (release = r)));

    const inflight = tracker.submit(action(), executor);
    await Promise.resolve(); // let the first attempt start

    await expect(tracker.submit(action(), executor)).rejects.toBeInstanceOf(
      RelayInFlightError
    );

    release({ hash: "done" });
    await inflight;
    expect(executor).toHaveBeenCalledTimes(1);
    expect(tracker.getStats().inFlightSkipped).toBe(1);
  });
});

describe("terminal failure", () => {
  it("stops retrying on a non-retryable error", async () => {
    const tracker = new RelaySubmissionTracker({
      maxAttempts: 5,
      sleep: noSleep,
      isRetryable: (err) => !(err instanceof Error && err.message.includes("INSUFFICIENT")),
    });
    const executor = vi
      .fn()
      .mockRejectedValue(new Error("INSUFFICIENT FUNDS"));

    await expect(tracker.submit(action(), executor)).rejects.toBeInstanceOf(
      RelayTerminalError
    );
    // Non-retryable -> only one attempt despite a budget of 5.
    expect(executor).toHaveBeenCalledTimes(1);
    expect(tracker.getRecord(action())?.status).toBe("failed");
  });

  it("re-throws terminal failure for a duplicate without re-submitting", async () => {
    const tracker = new RelaySubmissionTracker({ maxAttempts: 2, sleep: noSleep });
    const executor = vi.fn().mockRejectedValue(new Error("rpc exploded"));

    await expect(tracker.submit(action(), executor)).rejects.toBeInstanceOf(
      RelayTerminalError
    );
    const callsAfterFirst = executor.mock.calls.length;

    // A later duplicate request must not broadcast again.
    await expect(tracker.submit(action(), executor)).rejects.toBeInstanceOf(
      RelayTerminalError
    );
    expect(executor).toHaveBeenCalledTimes(callsAfterFirst);
  });
});

describe("retry budget and last error visibility", () => {
  it("exposes retry count, last error and terminal state via stats/records", async () => {
    const tracker = new RelaySubmissionTracker({ maxAttempts: 3, sleep: noSleep });

    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary blip"))
      .mockResolvedValueOnce({ hash: "recovered" });
    await tracker.submit(action({ orderId: "ok" }), flaky);

    const doomed = vi.fn().mockRejectedValue(new Error("permanent failure"));
    await tracker
      .submit(action({ orderId: "bad" }), doomed)
      .catch(() => undefined);

    const stats = tracker.getStats();
    expect(stats.tracked).toBe(2);
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.retries).toBeGreaterThanOrEqual(1);

    const badRecord = tracker.getRecord(action({ orderId: "bad" }));
    expect(badRecord?.attempts).toBe(3);
    expect(badRecord?.lastError).toBe("permanent failure");
  });

  it("throws RelayTimeoutError-shaped errors that the retry policy treats as retryable", async () => {
    const tracker = new RelaySubmissionTracker({
      maxAttempts: 1,
      timeoutMs: 5,
      sleep: noSleep,
    });
    let captured: unknown;
    const executor = () => new Promise(() => {});
    await tracker.submit(action(), executor).catch((e) => (captured = e));
    // With a budget of 1, the timeout becomes the terminal error.
    expect(captured).toBeInstanceOf(RelayTerminalError);
    expect((captured as RelayTerminalError).lastError).toMatch(/timed out/i);
    // Sanity: a raw timeout is its own error type.
    expect(new RelayTimeoutError("x")).toBeInstanceOf(Error);
  });
});
