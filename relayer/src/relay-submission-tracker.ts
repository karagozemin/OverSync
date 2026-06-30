/**
 * @fileoverview Idempotent relay submission tracking with a bounded retry budget.
 *
 * The relayer turns observed cross-chain events into on-chain submissions
 * (e.g. an ETH→XLM payment on Stellar, an XLM→ETH release on Ethereum). RPC
 * calls can time out or return ambiguous results, and a naive retry loop can
 * either re-submit the same action forever or broadcast it twice.
 *
 * This module gives every relay attempt a stable *submission fingerprint*
 * (idempotency key) derived from the logical action, and tracks per-key state:
 * how many attempts have run, the last error, and whether the action reached a
 * terminal success or failure. Retries are bounded and configurable, so a
 * timed-out relay can never submit the same action indefinitely, and a
 * duplicate request for an already-handled action is reported rather than
 * re-broadcast.
 *
 * The module is intentionally dependency-free (only Node's crypto) so it is
 * easy to unit test and reuse across the different submission paths.
 */

import { createHash } from 'crypto';

export type RelayStatus = 'in_flight' | 'succeeded' | 'failed';

/**
 * The logical identity of a cross-chain action being relayed. Two requests
 * that describe the same action (same order, same destination, same amount)
 * produce the same fingerprint and are therefore treated as duplicates.
 */
export interface RelayAction {
  /** High-level action kind, e.g. 'eth->xlm', 'xlm->eth', 'refund'. */
  kind: string;
  /** The order this submission belongs to. */
  orderId: string;
  /** Target chain for the submission, e.g. 'stellar' or 'ethereum'. */
  chain: string;
  /** Destination address, when applicable. */
  destination?: string;
  /** Amount being moved, as a string to avoid float drift. */
  amount?: string;
  /** Any additional fields that distinguish one submission from another. */
  extra?: Record<string, unknown>;
}

export interface SubmissionRecord<R = unknown> {
  key: string;
  action: RelayAction;
  status: RelayStatus;
  /** Number of times the executor has actually been invoked. */
  attempts: number;
  /** The configured ceiling on attempts for this submission. */
  maxAttempts: number;
  /** Last error message observed, if any. */
  lastError?: string;
  /** The successful result, once terminal success is reached. */
  result?: R;
  firstSeenAt: number;
  lastAttemptAt?: number;
  completedAt?: number;
}

export type RelayOutcome<R> = {
  /** `succeeded` = freshly submitted; `already_handled` = served from cache. */
  status: 'succeeded' | 'already_handled';
  result: R;
  record: SubmissionRecord<R>;
  /** True when this request matched a prior successful submission. */
  duplicate: boolean;
};

export type RelayTrackerEventType =
  | 'attempt'
  | 'retry'
  | 'success'
  | 'terminal_failure'
  | 'duplicate_skipped'
  | 'in_flight_skipped';

export interface RelayTrackerEvent {
  type: RelayTrackerEventType;
  key: string;
  action: RelayAction;
  attempt: number;
  maxAttempts: number;
  error?: string;
}

export interface RelayTrackerStats {
  tracked: number;
  inFlight: number;
  succeeded: number;
  failed: number;
  totalAttempts: number;
  /** Attempts beyond the first one (i.e. actual retries). */
  retries: number;
  duplicatesSkipped: number;
  inFlightSkipped: number;
}

export interface RelayTrackerConfig {
  /** Bounded retry budget — total executor invocations allowed (>= 1). */
  maxAttempts?: number;
  /** Per-attempt timeout in ms. 0 disables the timeout wrapper. */
  timeoutMs?: number;
  /** Base delay between attempts in ms. */
  retryDelayMs?: number;
  /** When true, delay grows exponentially (base * 2^(attempt-1)). */
  backoff?: boolean;
  /** Decide whether an error is worth retrying. Defaults to "always". */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  /** Metrics/observability hook fired on every state transition. */
  onEvent?: (event: RelayTrackerEvent) => void;
}

/** Raised when a per-attempt timeout elapses. Treated as retryable. */
export class RelayTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayTimeoutError';
  }
}

/** Raised when a submission has exhausted its retry budget or hit a
 * non-retryable error. The same key will keep throwing this rather than
 * re-submitting, which is what stops a timed-out relay from retrying forever. */
export class RelayTerminalError extends Error {
  readonly key: string;
  readonly attempts: number;
  readonly lastError?: string;
  constructor(key: string, attempts: number, lastError?: string) {
    super(
      `Relay submission ${key} failed terminally after ${attempts} attempt(s)` +
        (lastError ? `: ${lastError}` : '')
    );
    this.name = 'RelayTerminalError';
    this.key = key;
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/** Raised when a submission for the same key is already running. */
export class RelayInFlightError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Relay submission ${key} is already in flight`);
    this.name = 'RelayInFlightError';
    this.key = key;
  }
}

const DEFAULTS = {
  maxAttempts: 3,
  timeoutMs: 30_000,
  retryDelayMs: 2_000,
  backoff: true,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout that rejects with {@link RelayTimeoutError}.
 * The timer is always cleared so the process does not keep an open handle.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    handle = setTimeout(() => reject(new RelayTimeoutError(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Stable, order-independent serialization of an action's extra fields. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Compute a deterministic submission fingerprint (idempotency key) for an
 * action. Independent of field ordering in `extra`.
 */
export function computeFingerprint(action: RelayAction): string {
  const canonical = stableStringify({
    kind: action.kind,
    orderId: action.orderId,
    chain: action.chain,
    destination: action.destination ?? null,
    amount: action.amount ?? null,
    extra: action.extra ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export class RelaySubmissionTracker {
  private readonly records = new Map<string, SubmissionRecord>();
  private readonly cfg: Required<Omit<RelayTrackerConfig, 'onEvent' | 'logger'>> &
    Pick<RelayTrackerConfig, 'onEvent' | 'logger'>;
  private duplicatesSkipped = 0;
  private inFlightSkipped = 0;

  constructor(config: RelayTrackerConfig = {}) {
    const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? DEFAULTS.maxAttempts));
    this.cfg = {
      maxAttempts,
      timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
      retryDelayMs: config.retryDelayMs ?? DEFAULTS.retryDelayMs,
      backoff: config.backoff ?? DEFAULTS.backoff,
      isRetryable: config.isRetryable ?? (() => true),
      now: config.now ?? Date.now,
      sleep: config.sleep ?? defaultSleep,
      onEvent: config.onEvent,
      logger: config.logger,
    };
  }

  /** Total attempts allowed per submission (the retry budget). */
  get maxAttempts(): number {
    return this.cfg.maxAttempts;
  }

  fingerprint(action: RelayAction): string {
    return computeFingerprint(action);
  }

  getRecord(actionOrKey: RelayAction | string): SubmissionRecord | undefined {
    const key = typeof actionOrKey === 'string' ? actionOrKey : computeFingerprint(actionOrKey);
    return this.records.get(key);
  }

  /** Whether an action has already reached terminal success. */
  isHandled(action: RelayAction): boolean {
    return this.getRecord(action)?.status === 'succeeded';
  }

  /**
   * Submit a relay action exactly once, with a bounded retry budget.
   *
   * - If the action already succeeded, the cached result is returned and the
   *   executor is NOT run again (duplicate prevention).
   * - If the action previously failed terminally, {@link RelayTerminalError} is
   *   thrown without re-running the executor.
   * - If a submission for the same key is already running, {@link RelayInFlightError}
   *   is thrown.
   * - Otherwise the executor runs, retrying on retryable errors (timeouts are
   *   retryable) up to `maxAttempts`. When the budget is exhausted the record
   *   becomes terminally failed and {@link RelayTerminalError} is thrown.
   */
  async submit<R>(action: RelayAction, executor: () => Promise<R>): Promise<RelayOutcome<R>> {
    const key = computeFingerprint(action);
    const existing = this.records.get(key) as SubmissionRecord<R> | undefined;

    if (existing) {
      if (existing.status === 'succeeded') {
        this.duplicatesSkipped++;
        this.emit('duplicate_skipped', existing);
        this.cfg.logger?.log?.(
          `↪️  Relay ${key} already handled (${existing.attempts} attempt(s)); skipping duplicate submission`
        );
        return {
          status: 'already_handled',
          result: existing.result as R,
          record: existing,
          duplicate: true,
        };
      }
      if (existing.status === 'failed') {
        this.emit('terminal_failure', existing);
        throw new RelayTerminalError(key, existing.attempts, existing.lastError);
      }
      // status === 'in_flight'
      this.inFlightSkipped++;
      this.emit('in_flight_skipped', existing);
      throw new RelayInFlightError(key);
    }

    const record: SubmissionRecord<R> = {
      key,
      action,
      status: 'in_flight',
      attempts: 0,
      maxAttempts: this.cfg.maxAttempts,
      firstSeenAt: this.cfg.now(),
    };
    this.records.set(key, record as SubmissionRecord);

    while (record.attempts < this.cfg.maxAttempts) {
      record.attempts++;
      record.lastAttemptAt = this.cfg.now();
      this.emit('attempt', record);

      try {
        const result = await withTimeout(
          executor(),
          this.cfg.timeoutMs,
          `Relay ${key} timed out after ${this.cfg.timeoutMs}ms (attempt ${record.attempts}/${this.cfg.maxAttempts})`
        );
        record.status = 'succeeded';
        record.result = result;
        record.completedAt = this.cfg.now();
        this.emit('success', record);
        this.cfg.logger?.log?.(
          `✅ Relay ${key} succeeded on attempt ${record.attempts}/${this.cfg.maxAttempts}`
        );
        return { status: 'succeeded', result, record, duplicate: false };
      } catch (err) {
        record.lastError = errorMessage(err);
        const retryable = this.cfg.isRetryable(err);
        const budgetLeft = record.attempts < this.cfg.maxAttempts;

        if (retryable && budgetLeft) {
          this.emit('retry', record);
          this.cfg.logger?.warn?.(
            `⚠️  Relay ${key} attempt ${record.attempts}/${this.cfg.maxAttempts} failed: ${record.lastError}. Retrying...`
          );
          await this.cfg.sleep(this.delayFor(record.attempts));
          continue;
        }

        // Non-retryable error, or retry budget exhausted → terminal failure.
        record.status = 'failed';
        record.completedAt = this.cfg.now();
        this.emit('terminal_failure', record);
        this.cfg.logger?.error?.(
          `❌ Relay ${key} failed terminally after ${record.attempts}/${this.cfg.maxAttempts} attempt(s): ${record.lastError}`
        );
        throw new RelayTerminalError(key, record.attempts, record.lastError);
      }
    }

    // Defensive: loop only exits via return/throw, but keep TS satisfied.
    record.status = 'failed';
    record.completedAt = this.cfg.now();
    throw new RelayTerminalError(key, record.attempts, record.lastError);
  }

  private delayFor(attempt: number): number {
    if (!this.cfg.backoff) return this.cfg.retryDelayMs;
    return this.cfg.retryDelayMs * Math.pow(2, attempt - 1);
  }

  private emit(type: RelayTrackerEventType, record: SubmissionRecord): void {
    this.cfg.onEvent?.({
      type,
      key: record.key,
      action: record.action,
      attempt: record.attempts,
      maxAttempts: record.maxAttempts,
      error: record.lastError,
    });
  }

  getStats(): RelayTrackerStats {
    let inFlight = 0;
    let succeeded = 0;
    let failed = 0;
    let totalAttempts = 0;
    let retries = 0;
    for (const r of this.records.values()) {
      if (r.status === 'in_flight') inFlight++;
      else if (r.status === 'succeeded') succeeded++;
      else if (r.status === 'failed') failed++;
      totalAttempts += r.attempts;
      if (r.attempts > 1) retries += r.attempts - 1;
    }
    return {
      tracked: this.records.size,
      inFlight,
      succeeded,
      failed,
      totalAttempts,
      retries,
      duplicatesSkipped: this.duplicatesSkipped,
      inFlightSkipped: this.inFlightSkipped,
    };
  }

  /** Snapshot of all tracked records, newest first. */
  list(): SubmissionRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  }

  /** Drop a single record (e.g. to allow a manual re-submission). */
  forget(actionOrKey: RelayAction | string): boolean {
    const key = typeof actionOrKey === 'string' ? actionOrKey : computeFingerprint(actionOrKey);
    return this.records.delete(key);
  }

  /** Clear all tracked state. Primarily for tests. */
  reset(): void {
    this.records.clear();
    this.duplicatesSkipped = 0;
    this.inFlightSkipped = 0;
  }
}
