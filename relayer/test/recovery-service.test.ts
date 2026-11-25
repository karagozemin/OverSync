/**
 * @fileoverview Tests for RecoveryService (#268)
 *
 * All RPC calls are stubbed via a fake TxStatusProvider — no real
 * network is required.
 *
 * Acceptance criteria (from the issue):
 *  1. A pending hash that then confirms is NOT replaced / re-submitted.
 *  2. An expired hash IS replaced exactly once.
 *  3. A network mismatch refuses to start (NetworkMismatchError).
 *  4. Tests stub the RPC (TxStatusProvider).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RecoveryService,
  NetworkMismatchError,
  type TxStatusProvider,
  type TxStatus,
  type RecoveryServiceConfig,
} from '../src/recovery-service.js';
import {
  RelaySubmissionTracker,
  computeOrderKey,
  computeSubmissionKey,
  type RelayAction,
} from '../src/relay-submission-tracker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a RelayAction with sane defaults, optionally overriding fields. */
const makeAction = (overrides: Partial<RelayAction> = {}): RelayAction => ({
  orderId: 'order_abc',
  side: 'eth_to_xlm',
  action: 'claim',
  chain: 'stellar',
  destination: 'GUSER…',
  amount: '10.0000000',
  ...overrides,
});

/** Null sleep so the tracker's retry delays don't slow the suite. */
const noSleep = () => Promise.resolve();

/** A fake TxStatusProvider controlled per-test via a vi.fn(). */
function makeFakeProvider(defaultStatus: TxStatus = { kind: 'unknown' }): TxStatusProvider & {
  impl: ReturnType<typeof vi.fn>;
} {
  const impl = vi.fn<[string, string], Promise<TxStatus>>().mockResolvedValue(defaultStatus);
  return {
    impl,
    getTxStatus: (hash, chain) => impl(hash, chain),
  };
}

/**
 * Seed a tracker with an in-flight record for `action`.
 * The record's result is pre-stamped with txHash so extractTxHash works.
 * Returns the tracker and a release function that resolves the executor.
 */
async function seedInFlight(
  tracker: RelaySubmissionTracker,
  action: RelayAction,
  txHash: string
): Promise<{ release: () => void }> {
  seedRecord(tracker, action, txHash, 'pending');
  return { release: () => {} };
}

function seedRecord(
  tracker: RelaySubmissionTracker,
  action: RelayAction,
  txHash: string,
  status: 'pending' | 'failed'
): void {
  const key = computeSubmissionKey(action);
  const record = {
    key,
    orderKey: computeOrderKey(action.orderId, action.side),
    action,
    status,
    attempts: 1,
    maxAttempts: 3,
    broadcasts: 1,
    txHash,
    result: { hash: txHash },
    firstSeenAt: Date.now(),
  };
  (tracker as any).records.set(key, record);
}

/**
 * Seed a tracker with a succeeded record for `action`.
 */
async function seedSucceeded(
  tracker: RelaySubmissionTracker,
  action: RelayAction,
  txHash: string
): Promise<void> {
  await tracker.submit(action, () => ({
    txHash,
    broadcast: () => Promise.resolve({ hash: txHash }),
  }));
}

/**
 * Seed a tracker with a terminally-failed record for `action`.
 * The result is stamped with txHash so extractTxHash works.
 */
async function seedFailed(
  tracker: RelaySubmissionTracker,
  action: RelayAction,
  txHash: string
): Promise<void> {
  seedRecord(tracker, action, txHash, 'failed');
}

function makeConfig(
  extras: Partial<RecoveryServiceConfig> = {}
): RecoveryServiceConfig {
  return {
    expectedChains: ['stellar', 'ethereum'],
    pollingIntervalMs: 0, // disable background loop in tests
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Acceptance criterion 3: network mismatch refuses to start
// ---------------------------------------------------------------------------

describe('Network mismatch guard', () => {
  it('throws NetworkMismatchError when tracker has a row for an unexpected chain', async () => {
    const action = makeAction({ chain: 'solana' }); // NOT in expectedChains
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedSucceeded(tracker, action, '0xtxhash');
    const provider = makeFakeProvider({ kind: 'confirmed' });

    const svc = new RecoveryService(tracker, provider, makeConfig());

    await expect(svc.start()).rejects.toBeInstanceOf(NetworkMismatchError);
  });

  it('includes the mismatched and expected chains in the error', async () => {
    const action = makeAction({ chain: 'cosmos' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedSucceeded(tracker, action, '0xtxhash');
    const provider = makeFakeProvider({ kind: 'confirmed' });

    const svc = new RecoveryService(tracker, provider, makeConfig());

    const err = await svc.start().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkMismatchError);
    expect((err as NetworkMismatchError).unexpected).toContain('cosmos');
    expect((err as NetworkMismatchError).expected).toEqual(['ethereum', 'stellar']);
  });

  it('starts normally when all tracker rows belong to expected chains', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedSucceeded(tracker, action, '0xtxhash');
    const provider = makeFakeProvider({ kind: 'confirmed' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    await expect(svc.start()).resolves.toBeUndefined();
    svc.stop();
  });

  it('starts normally on an empty tracker (no rows to validate)', async () => {
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const provider = makeFakeProvider();

    const svc = new RecoveryService(tracker, provider, makeConfig());
    await expect(svc.start()).resolves.toBeUndefined();
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: pending hash that confirms is NOT replaced
// ---------------------------------------------------------------------------

describe('Confirmed hash — not replaced', () => {
  it('patches an in-flight record to succeeded without calling a second executor', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const { release } = await seedInFlight(tracker, action, '0xabc');

    const provider = makeFakeProvider({ kind: 'confirmed' });
    const svc = new RecoveryService(tracker, provider, makeConfig());

    const report = await svc.recoverPendingRows();

    expect(report.alreadyConfirmed).toContain(computeSubmissionKey(action));
    expect(report.replaced).toHaveLength(0);

    // The record should now be succeeded
    const record = tracker.getRecord(action);
    expect(record?.status).toBe('succeeded');

    // Clean up the dangling in-flight promise (resolves after forget+resubmit)
    release();
  });

  it('does not replace a succeeded record even if RPC says confirmed', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedSucceeded(tracker, action, '0xdef');
    const provider = makeFakeProvider({ kind: 'confirmed' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    const report = await svc.recoverPendingRows();

    // succeeded rows are not in the in_flight/failed filter → not polled at all
    expect(report.alreadyConfirmed).toHaveLength(0);
    expect(report.replaced).toHaveLength(0);
    expect(provider.impl).not.toHaveBeenCalled();
  });

  it('returns stillPending when RPC reports pending', async () => {
    const action = makeAction({ chain: 'ethereum' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const { release } = await seedInFlight(tracker, action, '0xpending');

    const provider = makeFakeProvider({ kind: 'pending' });
    const svc = new RecoveryService(tracker, provider, makeConfig());

    const report = await svc.recoverPendingRows();

    expect(report.stillPending).toContain(computeSubmissionKey(action));
    expect(report.replaced).toHaveLength(0);

    // The pending hash remains in the tracker and owns the duplicate gate.
    expect(tracker.getRecord(action)?.status).toBe('pending');

    release();
  });

  it('does NOT broadcast a second claim when confirmed in the poll', async () => {
    // Simulates the core bug: relayer restarts, sees an in-flight record,
    // RPC says confirmed → we must not call any executor again.
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const { release } = await seedInFlight(tracker, action, '0xtxhash1');

    const executorCallCount = { n: 0 };
    const provider = makeFakeProvider({ kind: 'confirmed' });
    const svc = new RecoveryService(tracker, provider, makeConfig());

    await svc.recoverPendingRows();

    // Record is now succeeded — a second submit must return already_handled
    const secondAttempt = await tracker.submit(action, () => ({
      txHash: '0xsecond',
      broadcast: async () => {
        executorCallCount.n++;
        return { hash: '0xsecond' };
      },
    }));

    expect(secondAttempt.status).toBe('already_handled');
    expect(executorCallCount.n).toBe(0);

    release();
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: expired hash is replaced exactly once
// ---------------------------------------------------------------------------

describe('Expired hash — replaced exactly once', () => {
  it('forgets a failed record whose tx is expired so a new submission can proceed', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xexpiredtx');
    const provider = makeFakeProvider({ kind: 'expired' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    const report = await svc.recoverPendingRows();

    expect(report.replaced).toContain(computeSubmissionKey(action));
    expect(report.alreadyConfirmed).toHaveLength(0);

    // Record should be gone so a fresh submit is possible
    expect(tracker.getRecord(action)).toBeUndefined();
  });

  it('allows exactly one replacement submission after forget', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xexpiredtx2');
    const provider = makeFakeProvider({ kind: 'expired' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    await svc.recoverPendingRows();

    // A replacement is now possible
    const replacementExecutor = vi.fn().mockResolvedValue({ hash: '0xnewtx' });
    const outcome = await tracker.submit(action, () => ({
      txHash: '0xnewtx',
      broadcast: replacementExecutor,
    }));

    expect(replacementExecutor).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe('succeeded');
    expect(outcome.result).toEqual({ hash: '0xnewtx' });

    // A SECOND call for the same action must NOT re-run the executor
    const secondExecutor = vi.fn().mockResolvedValue({ hash: '0xthirdtx' });
    const second = await tracker.submit(action, () => ({
      txHash: '0xthirdtx',
      broadcast: secondExecutor,
    }));
    expect(secondExecutor).toHaveBeenCalledTimes(0);
    expect(second.status).toBe('already_handled');
  });

  it('forgets the expired record only once per recovery cycle', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xexpiredtx3');
    const provider = makeFakeProvider({ kind: 'expired' });

    const svc = new RecoveryService(tracker, provider, makeConfig());

    // First recovery cycle: record is forgotten
    const report1 = await svc.recoverPendingRows();
    expect(report1.replaced).toHaveLength(1);

    // After a replacement submission the record is succeeded
    await tracker.submit(action, () => ({
      txHash: '0xreplacement',
      broadcast: () => Promise.resolve({ hash: '0xreplacement' }),
    }));

    // Second recovery cycle: the record is now succeeded → not polled
    const report2 = await svc.recoverPendingRows();
    expect(report2.replaced).toHaveLength(0);
    // Provider was only called for the first (failed) record
    expect(provider.impl).toHaveBeenCalledTimes(1);
  });

  it('forgets an in-flight record when RPC says expired', async () => {
    // An in-flight record whose tx the RPC reports as expired should also be
    // cleared so a replacement can be submitted.
    const action = makeAction({ chain: 'ethereum' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const { release } = await seedInFlight(tracker, action, '0xtxhash');

    const provider = makeFakeProvider({ kind: 'expired' });
    const svc = new RecoveryService(tracker, provider, makeConfig());

    const report = await svc.recoverPendingRows();
    expect(report.replaced).toContain(computeSubmissionKey(action));

    // The dangling in-flight promise resolves after forget; clean up.
    release();
  });
});

// ---------------------------------------------------------------------------
// Startup bootstrap — loads pending rows before accepting new work
// ---------------------------------------------------------------------------

describe('Startup bootstrap', () => {
  it('calls recoverPendingRows during start() before returning', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xstartuptx');
    const provider = makeFakeProvider({ kind: 'expired' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    await svc.start();

    // The expired record should have been cleared during startup
    expect(tracker.getRecord(action)).toBeUndefined();
    svc.stop();
  });

  it('is idempotent — calling start() twice does not double-poll', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xidempotent');
    const provider = makeFakeProvider({ kind: 'pending' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    await svc.start();
    await svc.start(); // second call should be a no-op

    svc.stop();
    // Provider should only have been called once (from the first start)
    expect(provider.impl).toHaveBeenCalledTimes(1);
  });

  it('starts and stops the background polling loop', async () => {
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    const provider = makeFakeProvider({ kind: 'unknown' });

    const svc = new RecoveryService(tracker, provider, {
      expectedChains: ['stellar'],
      pollingIntervalMs: 100,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await svc.start();
    // Wait a tick to verify stop() works without throwing
    await new Promise((r) => setTimeout(r, 50));
    svc.stop();
    // After stop the service can be restarted (started flag reset)
    expect(() => svc.stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unknown / no-hash rows
// ---------------------------------------------------------------------------

describe('Unknown status and missing tx hash', () => {
  it('classifies an unknown RPC response as unknown — record untouched', async () => {
    const action = makeAction({ chain: 'stellar' });
    const tracker = new RelaySubmissionTracker({ sleep: noSleep });
    await seedFailed(tracker, action, '0xunknown');
    const provider = makeFakeProvider({ kind: 'unknown' });

    const svc = new RecoveryService(tracker, provider, makeConfig());
    const report = await svc.recoverPendingRows();

    expect(report.unknown).toContain(computeSubmissionKey(action));
    expect(tracker.getRecord(action)).toBeDefined(); // not forgotten
  });

  it('classifies a record with no tx hash as unknown', async () => {
    // Build a failed record that has no result at all
    const action = makeAction({ chain: 'stellar', orderId: 'no-hash-order' });
    const tracker = new RelaySubmissionTracker({ maxAttempts: 1, sleep: noSleep });
    await tracker.submit(action, () => Promise.reject(new Error('boom'))).catch(() => undefined);
    // record.result is undefined — extractTxHash returns null

    const provider = makeFakeProvider({ kind: 'confirmed' });
    const svc = new RecoveryService(tracker, provider, makeConfig());
    const report = await svc.recoverPendingRows();

    expect(report.unknown).toContain(computeSubmissionKey(action));
    // Provider should NOT have been called because there was nothing to query
    expect(provider.impl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multiple pending rows — processed independently
// ---------------------------------------------------------------------------

describe('Multiple pending rows', () => {
  it('handles confirmed, expired, and pending rows in the same poll', async () => {
    const aConfirmed = makeAction({ orderId: 'confirmed-order', chain: 'stellar' });
    const aExpired = makeAction({ orderId: 'expired-order', chain: 'ethereum' });
    const aPending = makeAction({ orderId: 'pending-order', chain: 'stellar' });

    const tracker = new RelaySubmissionTracker({ sleep: noSleep });

    // confirmed: in_flight
    const { release: relConf } = await seedInFlight(tracker, aConfirmed, '0xconf');

    // expired: failed
    await seedFailed(tracker, aExpired, '0xexp');

    // pending: in_flight
    const { release: relPend } = await seedInFlight(tracker, aPending, '0xpend');

    const provider: TxStatusProvider = {
      getTxStatus: vi.fn(async (hash) => {
        if (hash === '0xconf') return { kind: 'confirmed' };
        if (hash === '0xexp') return { kind: 'expired' };
        return { kind: 'pending' };
      }),
    };

    const svc = new RecoveryService(tracker, provider, makeConfig());
    const report = await svc.recoverPendingRows();

    expect(report.alreadyConfirmed).toContain(computeSubmissionKey(aConfirmed));
    expect(report.replaced).toContain(computeSubmissionKey(aExpired));
    expect(report.stillPending).toContain(computeSubmissionKey(aPending));

    // Confirmed → succeeded; expired → gone; pending → still pending
    expect(tracker.getRecord(aConfirmed)?.status).toBe('succeeded');
    expect(tracker.getRecord(aExpired)).toBeUndefined();
    expect(tracker.getRecord(aPending)?.status).toBe('pending');

    relConf();
    relPend();
  });
});
