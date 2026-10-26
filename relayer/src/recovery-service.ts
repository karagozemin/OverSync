/**
 * @fileoverview Recovery Service — tracker-aware relay recovery.
 *
 * ## Why this exists
 * The original recovery service kept its own in-memory Map of "recovery
 * requests" that was completely separate from `RelaySubmissionTracker`.
 * After a restart the tracker still had rows for submissions that were
 * in-flight or had timed out, but the recovery service didn't know about
 * them.  It would therefore create a brand-new submission for the same
 * logical action, broadcasting a second claim or refund transaction.
 *
 * ## What changed
 * Recovery is now a *reader* of the tracker, not a second submitter:
 *
 * 1. **Startup bootstrap** — `start()` loads every `in_flight` or
 *    `failed` row from the tracker and polls each one via the RPC
 *    before deciding whether new work is needed.
 *
 * 2. **Confirmed hash short-circuit** — if the RPC reports the
 *    transaction as confirmed the record is patched to `succeeded`
 *    (via a no-op re-submit that returns `already_handled`) and no
 *    second broadcast is made.
 *
 * 3. **Expired hash replacement** — if the RPC reports the transaction
 *    as expired/dropped *and* the record is not already succeeded or
 *    in-flight, the record is forgotten so the next `submit()` call
 *    gets a clean slate.  The replacement is performed exactly once
 *    because `forget()` only removes the old key; the new submission
 *    immediately re-registers under the same key.
 *
 * 4. **Network guard** — the tracker records the `chain` field of every
 *    action.  Before starting, `RecoveryService` compares the chains
 *    present in the tracker against the configured `expectedChains` set
 *    and throws a `NetworkMismatchError` if any row belongs to an
 *    unexpected chain.
 *
 * ## RPC abstraction
 * All on-chain queries are performed through the `TxStatusProvider`
 * interface so the real Ethereum/Stellar provider can be swapped for a
 * stub in tests without touching process-level globals.
 */

import {
  RelaySubmissionTracker,
  type RelayAction,
  type SubmissionRecord,
} from './relay-submission-tracker.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** What the RPC layer reports for a previously-broadcast transaction. */
export type TxStatus =
  | { kind: 'confirmed' }   // on-chain and finalised
  | { kind: 'pending' }     // still in the mempool / not yet finalised
  | { kind: 'expired' }     // dropped / nonce superseded / never landed
  | { kind: 'unknown' };    // no information — treat conservatively

/**
 * Minimal RPC abstraction used by the recovery service.
 * Swap in a stub for unit tests; no ethers/stellar-sdk imports required.
 */
export interface TxStatusProvider {
  /**
   * Return the current status of a previously-submitted transaction.
   *
   * @param txHash   The hash that was broadcast, stored in `record.result`.
   * @param chain    The target chain, e.g. `'ethereum'` or `'stellar'`.
   */
  getTxStatus(txHash: string, chain: string): Promise<TxStatus>;
}

/** Thrown by `RecoveryService.start()` when the tracker holds rows for a
 *  chain that is not in `expectedChains`. */
export class NetworkMismatchError extends Error {
  readonly unexpected: string[];
  readonly expected: string[];
  constructor(unexpected: string[], expected: string[]) {
    super(
      `Recovery refused: tracker contains rows for chains [${unexpected.join(', ')}] ` +
        `which are not in the configured set [${expected.join(', ')}]`
    );
    this.name = 'NetworkMismatchError';
    this.unexpected = unexpected;
    this.expected = expected;
  }
}

export interface RecoveryServiceConfig {
  /**
   * The chains this process is authorised to handle, e.g.
   * `['ethereum', 'stellar']`.  Any tracker row for a different chain
   * will cause `start()` to throw a `NetworkMismatchError`.
   */
  expectedChains: string[];

  /**
   * How often the polling loop runs (ms).  Defaults to 30 000.
   * Set to 0 to disable the background loop (useful in tests that drive
   * the service manually).
   */
  pollingIntervalMs?: number;

  /**
   * Optional logger.  Defaults to `console`.
   */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/** Summary produced by `RecoveryService.recoverPendingRows()`. */
export interface RecoveryReport {
  /** Rows that were confirmed on-chain — no action taken. */
  alreadyConfirmed: string[];
  /** Rows that were replaced because their tx was expired/dropped. */
  replaced: string[];
  /** Rows that are still pending on-chain — nothing to do yet. */
  stillPending: string[];
  /** Rows where the status was unknown — left untouched. */
  unknown: string[];
  /** Any errors encountered per key. */
  errors: Record<string, string>;
}

// ---------------------------------------------------------------------------
// RecoveryService
// ---------------------------------------------------------------------------

export class RecoveryService {
  private readonly tracker: RelaySubmissionTracker;
  private readonly provider: TxStatusProvider;
  private readonly cfg: Required<Omit<RecoveryServiceConfig, 'logger'>> &
    Pick<RecoveryServiceConfig, 'logger'>;

  private pollingHandle: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    tracker: RelaySubmissionTracker,
    provider: TxStatusProvider,
    config: RecoveryServiceConfig
  ) {
    this.tracker = tracker;
    this.provider = provider;
    this.cfg = {
      expectedChains: config.expectedChains,
      pollingIntervalMs: config.pollingIntervalMs ?? 30_000,
      logger: config.logger,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Bootstrap the recovery service.
   *
   * 1. Validates that every pending tracker row belongs to an expected chain.
   * 2. Polls pending rows and resolves their status via the RPC.
   * 3. Starts the background polling loop (unless `pollingIntervalMs` is 0).
   *
   * Throws `NetworkMismatchError` if any row targets an unexpected chain.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.log('recovery-service: starting bootstrap …');

    // Step 1 — network guard
    this.assertNetworkMatch();

    // Step 2 — poll all pending rows before accepting new work
    await this.recoverPendingRows();

    // Step 3 — start background loop
    if (this.cfg.pollingIntervalMs > 0) {
      this.pollingHandle = setInterval(() => {
        void this.recoverPendingRows().catch((err) =>
          this.cfg.logger?.error?.('recovery-service: background poll error', err)
        );
      }, this.cfg.pollingIntervalMs);
    }

    this.log('recovery-service: bootstrap complete');
  }

  /**
   * Stop the background polling loop.
   */
  stop(): void {
    if (this.pollingHandle !== null) {
      clearInterval(this.pollingHandle);
      this.pollingHandle = null;
    }
    this.started = false;
    this.log('recovery-service: stopped');
  }

  /**
   * Examine every `in_flight` and `failed` tracker row and, for each one,
   * query the RPC to decide what should happen next:
   *
   * - **confirmed** → patch the record to `succeeded` via a no-op
   *   re-submit so the duplicate gate prevents any second broadcast.
   * - **expired/dropped** → `forget()` the record so the caller can
   *   re-submit under the same key without hitting the terminal-failure
   *   guard.  The replacement happens exactly once.
   * - **pending / unknown** → leave the record alone; the in-flight guard
   *   in the tracker already prevents a second broadcast.
   *
   * Returns a structured report for observability/testing.
   */
  async recoverPendingRows(): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      alreadyConfirmed: [],
      replaced: [],
      stillPending: [],
      unknown: [],
      errors: {},
    };

    const rows = this.tracker
      .list()
      .filter((r) => r.status === 'in_flight' || r.status === 'failed');

    if (rows.length === 0) return report;

    this.log(`recovery-service: polling ${rows.length} pending row(s) …`);

    await Promise.all(
      rows.map(async (record) => {
        try {
          await this.processRow(record, report);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          report.errors[record.key] = msg;
          this.cfg.logger?.error?.(
            `recovery-service: error processing row ${record.key}: ${msg}`
          );
        }
      })
    );

    this.log(
      `recovery-service: poll complete — confirmed=${report.alreadyConfirmed.length} ` +
        `replaced=${report.replaced.length} pending=${report.stillPending.length} ` +
        `unknown=${report.unknown.length} errors=${Object.keys(report.errors).length}`
    );

    return report;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Guard: throw `NetworkMismatchError` if the tracker contains rows for
   * chains that are not in `expectedChains`.
   */
  private assertNetworkMatch(): void {
    const expected = new Set(this.cfg.expectedChains);
    const unexpected = new Set<string>();

    for (const record of this.tracker.list()) {
      const chain = record.action.chain;
      if (!expected.has(chain)) {
        unexpected.add(chain);
      }
    }

    if (unexpected.size > 0) {
      throw new NetworkMismatchError(
        Array.from(unexpected).sort(),
        Array.from(expected).sort()
      );
    }
  }

  /**
   * Process a single tracker row:
   *  - Extract the tx hash from `record.result` (stored as `{ hash: string }` or a bare string).
   *  - Query the RPC.
   *  - Act on the result.
   */
  private async processRow(
    record: SubmissionRecord,
    report: RecoveryReport
  ): Promise<void> {
    const txHash = extractTxHash(record.result);

    // If there is no tx hash yet (e.g. the record was created but the
    // executor never ran a single attempt), treat as unknown.
    if (!txHash) {
      report.unknown.push(record.key);
      this.log(
        `recovery-service: row ${record.key} has no tx hash — leaving untouched`
      );
      return;
    }

    const status = await this.provider.getTxStatus(txHash, record.action.chain);

    switch (status.kind) {
      case 'confirmed': {
        // The tx landed on-chain.  We patch the record to succeeded by
        // calling submit() with a no-op executor that immediately resolves
        // with the existing result.  Because the record is `in_flight` or
        // `failed`, we first forget it so the tracker accepts the new call.
        //
        // Special case: if it is already `succeeded` somehow, do nothing.
        if (record.status === 'succeeded') {
          report.alreadyConfirmed.push(record.key);
          return;
        }
        this.log(
          `recovery-service: row ${record.key} confirmed on-chain — patching to succeeded`
        );
        // Forget the old record so submit() can create a fresh one.
        this.tracker.forget(record.key);
        // Re-submit with an executor that immediately resolves with the
        // original result so the duplicate gate is armed.
        await this.tracker.submit(record.action, () =>
          Promise.resolve(record.result)
        );
        report.alreadyConfirmed.push(record.key);
        break;
      }

      case 'expired': {
        // The tx was dropped.  Forget the record so a fresh submission can
        // be made.  We do NOT re-submit here — we only clear the gate.
        // The caller (the relay handler or a scheduled job) is responsible
        // for broadcasting the replacement transaction exactly once.
        this.log(
          `recovery-service: row ${record.key} expired — forgetting for replacement`
        );
        this.tracker.forget(record.key);
        report.replaced.push(record.key);
        break;
      }

      case 'pending': {
        // Still in the mempool.  The in-flight / terminal-failure guard in
        // the tracker already prevents a second broadcast.
        report.stillPending.push(record.key);
        break;
      }

      case 'unknown':
      default: {
        // No information — leave the record as-is to avoid accidental
        // double-sends.
        report.unknown.push(record.key);
        break;
      }
    }
  }

  private log(msg: string): void {
    (this.cfg.logger ?? console).log?.(msg);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract a transaction hash from whatever shape `record.result` might be.
 * The tracker stores the executor's return value verbatim; relay executors
 * typically return `{ hash: '0x…' }` or a plain string.
 */
function extractTxHash(result: unknown): string | null {
  if (typeof result === 'string' && result.length > 0) return result;
  if (result !== null && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj['hash'] === 'string' && obj['hash'].length > 0) return obj['hash'];
    if (typeof obj['txHash'] === 'string' && obj['txHash'].length > 0) return obj['txHash'];
    if (typeof obj['id'] === 'string' && obj['id'].length > 0) return obj['id'];
  }
  return null;
}

export default RecoveryService;
