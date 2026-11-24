/**
 * @fileoverview Single-flight relay submission tracking for cross-chain orders.
 *
 * Three doors used to be able to move money for one order at the same time:
 * the `/api/orders/*` request handlers, the recovery service, and the refund
 * watchdog. Two submissions for one order could therefore *claim* the funds and
 * *refund* them at the same time, and a timed-out RPC could be retried into a
 * second broadcast of the same logical payment.
 *
 * This module is the only door they share. It guarantees, per
 * (orderId, side, action):
 *
 *  1. **One in-flight submission.** The key is reserved before any work starts,
 *     so overlapping callers collapse onto a single broadcast.
 *  2. **One action per order.** A submission holds an order-level lock
 *     (`orderId|side`). A second *action* on the same order — e.g. a refund
 *     while a claim is pending — is refused with {@link RelayOrderBusyError}.
 *  3. **Hash before broadcast.** A submission is staged in two phases: the
 *     caller computes the transaction hash locally (Stellar: the envelope hash,
 *     Ethereum: keccak of the signed payload), and only then may it broadcast.
 *     The tracker persists `txHash` + `network` + `status` *before* the
 *     broadcast closure is invoked, so a crash mid-broadcast still leaves a
 *     hash to reconcile against.
 *  4. **Retry attaches to the original hash.** Once a hash exists the executor
 *     is never called again. A retry polls the stored hash through the
 *     `confirm` hook until it reaches a terminal state, so an ambiguous RPC can
 *     never produce a second on-chain transaction.
 *  5. **Restart safety.** Records are written to a {@link RelaySubmissionStore}
 *     on every transition. A confirmed hash is rehydrated and returned from
 *     cache instead of being resubmitted; a broadcast-but-unconfirmed hash is
 *     rehydrated as `pending` and reconciled by polling.
 *
 * The module is deliberately dependency-free (only `node:crypto`, and
 * `node:fs`/`node:path` for the bundled file store) so it is easy to unit test
 * without a live chain: every network interaction is injected as `confirm`.
 */

import { createHash } from 'node:crypto';
import {
  FileRelaySubmissionStore,
  MemoryRelaySubmissionStore,
  type RelaySubmissionStore,
  type PersistedSubmission,
} from './relay-submission-store.js';

export { FileRelaySubmissionStore, MemoryRelaySubmissionStore };
export type { RelaySubmissionStore, PersistedSubmission };

/** The side values used by the relayer's live swap flow. */
export const RELAY_SIDES = ['eth_to_xlm', 'xlm_to_eth'] as const;

/**
 * Which direction of the swap the submission belongs to. Two submissions on the
 * same order but different sides are independent flows (an ETH→XLM payout and
 * an unrelated XLM→ETH payout never share an order id), so the side is part of
 * the single-flight scope.
 *
 * Kept as a plain `string` union of literals so callers may introduce a new
 * direction without touching this module; {@link RELAY_SIDES} documents the
 * values the relayer uses today.
 */
export type RelaySide = (typeof RELAY_SIDES)[number] | string;

/** The action values used by the relayer today. */
export const RELAY_ACTION_NAMES = [
  'claim',
  'release',
  'refund',
  'lock',
  'escrow',
] as const;

/**
 * The action being performed on the order. `claim`/`release` move funds to the
 * user, `refund` moves them back, `lock`/`escrow` create the source-side
 * escrow. The tracker treats every distinct action as a mutually exclusive
 * door for the order.
 */
export type RelayActionName = (typeof RELAY_ACTION_NAMES)[number] | string;

/** The chain values used by the relayer today. */
export const RELAY_CHAINS = ['stellar', 'ethereum'] as const;

/** Target chain of the submission. */
export type RelayChain = (typeof RELAY_CHAINS)[number] | string;

/**
 * `in_flight`  – key reserved, no hash yet, the stager/broadcast is running.
 * `pending`    – a hash is known; the transaction is being reconciled.
 * `succeeded`  – the transaction reached a terminal success (lock stays held).
 * `failed`     – the transaction is known bad or never appeared (lock released).
 */
export type RelayStatus = 'in_flight' | 'pending' | 'succeeded' | 'failed';

/**
 * The logical identity of a cross-chain action. The submission key is derived
 * from `orderId` + `side` + `action` only — never from the amount, the
 * destination, or `extra` — so a refund recomputed with a slightly different
 * amount, or a payout re-priced by a fresh quote, still resolves to the same
 * single-flight slot instead of forking into a second broadcast.
 */
export interface RelayAction {
  /** The order this submission belongs to. */
  orderId: string;
  /** Direction of the swap the submission belongs to. */
  side: RelaySide;
  /** Which action is being performed. */
  action: RelayActionName;
  /** Target chain for the submission. */
  chain: RelayChain;
  /** Network the hash belongs to (e.g. `mainnet` / `testnet` / `sepolia`). */
  network?: string;
  /** Destination address, when applicable. Diagnostics only — not keyed on. */
  destination?: string;
  /** Amount being moved, as a string to avoid float drift. Diagnostics only. */
  amount?: string;
  /** Any additional fields that describe the submission. Diagnostics only. */
  extra?: Record<string, unknown>;
}

/**
 * A submission that has been fully prepared but not yet broadcast.
 *
 * The two-phase shape is the whole point: the hash must be computable from the
 * signed payload *before* any network call, so the tracker can persist it
 * before the transaction can possibly land.
 */
export interface StagedSubmission<R> {
  /** Transaction hash, known locally before the broadcast. */
  txHash: string;
  /** Network the hash belongs to. Falls back to `action.network`. */
  network?: string;
  /** Perform the broadcast (and, if desired, await confirmation). */
  broadcast: () => Promise<R>;
}

export type RelayStager<R> = () => StagedSubmission<R> | Promise<StagedSubmission<R>>;

/** Everything a confirmer needs to look the transaction up on-chain. */
export interface RelayConfirmationRef {
  key: string;
  orderKey: string;
  txHash: string;
  chain: RelayChain;
  network?: string;
  orderId: string;
  side: RelaySide;
  action: RelayActionName;
  attempt: number;
  maxAttempts: number;
}

/**
 * `succeeded` – terminal success, the submission is done.
 * `failed`    – terminal failure, the submission must not be retried.
 * `pending`   – the node knows the hash but has not settled it yet.
 * `not_found` – the node has never seen the hash (it may still be propagating).
 */
export type RelayConfirmationState = 'succeeded' | 'failed' | 'pending' | 'not_found';

export interface RelayConfirmation {
  state: RelayConfirmationState;
  /** Human-readable detail, surfaced as `record.lastError`. */
  error?: string;
  /** Terminal result payload, when the confirmer can cheaply return one. */
  result?: unknown;
}

/**
 * Chain-agnostic confirmation lookup. Implementations must never throw for a
 * missing/unknown hash — return `{ state: 'not_found' }` instead.
 */
export type RelayConfirmer = (ref: RelayConfirmationRef) => Promise<RelayConfirmation>;

export interface SubmissionRecord<R = unknown> {
  key: string;
  /** Single-flight lock scope: `<orderId>|<side>`. */
  orderKey: string;
  action: RelayAction;
  status: RelayStatus;
  /** Executor invocations spent on this submission (1 broadcast + polls). */
  attempts: number;
  /** The configured ceiling on attempts for this submission. */
  maxAttempts: number;
  /**
   * How many times a broadcast closure was invoked. The tracker guarantees this
   * never exceeds 1 for a given key — surfaced for metrics and tests.
   */
  broadcasts: number;
  /** Transaction hash, persisted before the broadcast is attempted. */
  txHash?: string;
  /** Network the hash belongs to, persisted alongside it. */
  network?: string;
  /** Last error message observed, if any. */
  lastError?: string;
  /** Why the record became `failed`, when it did. */
  terminalReason?: RelayTerminalReason;
  /** The successful result, once terminal success is reached. */
  result?: R;
  firstSeenAt: number;
  lastAttemptAt?: number;
  completedAt?: number;
  /** True when the record was rehydrated from the store after a restart. */
  restored?: boolean;
}

export interface RelayOutcome<R> {
  /** `succeeded` = this call drove the broadcast; `already_handled` = served from a stored hash. */
  status: 'succeeded' | 'already_handled';
  result: R;
  record: SubmissionRecord<R>;
  /** True when this request matched a prior (or in-flight) submission. */
  duplicate: boolean;
  /** The single on-chain hash for this (orderId, side, action). */
  txHash?: string;
  network?: string;
  /** True when the result came from reconciling a stored hash rather than a fresh broadcast. */
  reconciled?: boolean;
}

export type RelayTrackerEventType =
  | 'attempt'
  | 'broadcast'
  | 'retry'
  | 'confirmation_pending'
  | 'confirmation_timeout'
  | 'success'
  | 'terminal_failure'
  | 'duplicate_skipped'
  | 'in_flight_skipped'
  | 'order_busy'
  | 'restored';

export interface RelayTrackerEvent {
  type: RelayTrackerEventType;
  key: string;
  orderKey?: string;
  action: RelayAction;
  attempt: number;
  maxAttempts: number;
  txHash?: string;
  network?: string;
  /** Present on `order_busy`: the submission that currently owns the order. */
  blockingKey?: string;
  error?: string;
}

export interface RelayTrackerStats {
  tracked: number;
  inFlight: number;
  /** Records holding a hash that is not terminal yet. */
  pendingConfirmations: number;
  succeeded: number;
  failed: number;
  totalAttempts: number;
  /** Attempts beyond the first one (i.e. actual retries). */
  retries: number;
  /** Total broadcasts across all keys. Must be <= the number of records. */
  broadcasts: number;
  duplicatesSkipped: number;
  inFlightSkipped: number;
  /** Submissions refused because another action owned the order. */
  orderBlocked: number;
  /** Records rehydrated from the store at startup. */
  restored: number;
  /** Store write failures. Persistence never breaks a submission. */
  storeErrors: number;
}

export interface RelayTrackerConfig {
  /** Bounded retry budget — one broadcast plus at most `maxAttempts - 1` polls. */
  maxAttempts?: number;
  /** Per-attempt timeout in ms for staging and for the broadcast closure. 0 disables it. */
  timeoutMs?: number;
  /** Base delay between polls in ms (doubles when `backoff` is set). */
  retryDelayMs?: number;
  /** Delay between confirmation polls in ms (doubles when `backoff` is set). */
  pollIntervalMs?: number;
  /** When true, delays grow exponentially (base * 2^(n-1)). */
  backoff?: boolean;
  /** Chain lookup used to drive a stored hash to a terminal state. */
  confirm?: RelayConfirmer;
  /** Persistence backend. Omit for a process-lifetime (non-restart-safe) tracker. */
  store?: RelaySubmissionStore;
  /** Decide whether a staging error is worth retrying. Defaults to "always". */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
  /** Metrics/observability hook fired on every state transition. */
  onEvent?: (event: RelayTrackerEvent) => void;
}

/** Base class for every error this module raises. */
export class RelaySubmissionError extends Error {
  readonly key: string;
  constructor(key: string, message: string) {
    super(message);
    this.name = 'RelaySubmissionError';
    this.key = key;
  }
}

/** Raised when a per-attempt timeout elapses. Treated as retryable. */
export class RelayTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayTimeoutError';
  }
}

export type RelayTerminalReason = 'failed' | 'not_found' | 'non_retryable' | 'staging_failed';

/**
 * Raised when a submission is known to be dead: it failed on-chain, its hash
 * never appeared anywhere, staging failed, or it hit a non-retryable error. The
 * same key keeps throwing this instead of re-submitting, which is what stops a
 * timed-out relay from retrying forever. The order lock is released so the
 * recovery path (e.g. a refund) can take over.
 */
export class RelayTerminalError extends RelaySubmissionError {
  readonly attempts: number;
  readonly lastError?: string;
  readonly reason: RelayTerminalReason;
  constructor(key: string, attempts: number, lastError?: string, reason: RelayTerminalReason = 'failed') {
    super(
      key,
      `Relay submission ${key} failed terminally after ${attempts} attempt(s)` +
        (lastError ? `: ${lastError}` : '')
    );
    this.name = 'RelayTerminalError';
    this.attempts = attempts;
    this.lastError = lastError;
    this.reason = reason;
  }
}

/**
 * Raised when a submission is still unresolved: the hash is on-chain (or may
 * be) but the confirmation budget ran out. The record stays `pending` and the
 * order lock stays held, so nothing else can broadcast for this order. A later
 * `submit()` resumes polling the same hash.
 */
export class RelayConfirmationTimeoutError extends RelaySubmissionError {
  readonly txHash?: string;
  readonly network?: string;
  readonly attempts: number;
  constructor(key: string, txHash: string | undefined, network: string | undefined, attempts: number) {
    super(
      key,
      `Relay submission ${key} is still unconfirmed after ${attempts} attempt(s)` +
        (txHash ? ` (tx ${txHash}${network ? ` on ${network}` : ''} not terminal)` : '')
    );
    this.name = 'RelayConfirmationTimeoutError';
    this.txHash = txHash;
    this.network = network;
    this.attempts = attempts;
  }
}

/** Raised when a submission for the same key is already running. */
export class RelayInFlightError extends RelaySubmissionError {
  constructor(key: string) {
    super(key, `Relay submission ${key} is already in flight`);
    this.name = 'RelayInFlightError';
  }
}

/**
 * Raised when a *different* action for the same order already owns the
 * single-flight lock — e.g. a refund requested while the claim is still
 * unconfirmed. Extends {@link RelayInFlightError} so callers that already map
 * "relay busy" to HTTP 409 keep working unchanged.
 */
export class RelayOrderBusyError extends RelayInFlightError {
  readonly blockingKey: string;
  readonly blockingAction: RelayActionName;
  readonly blockingStatus: RelayStatus;
  readonly requestedAction: RelayActionName;
  readonly orderId: string;
  readonly side: RelaySide;
  constructor(requested: RelayAction, blocking: SubmissionRecord) {
    super(blocking.key);
    this.name = 'RelayOrderBusyError';
    this.blockingKey = blocking.key;
    this.blockingAction = blocking.action.action;
    this.blockingStatus = blocking.status;
    this.requestedAction = requested.action;
    this.orderId = requested.orderId;
    this.side = requested.side;
    this.message =
      blocking.status === 'succeeded'
        ? `Order ${requested.orderId} (${requested.side}) is already settled by ${blocking.action.action} ` +
          `(tx ${blocking.txHash ?? 'unknown'}); refusing ${requested.action}`
        : `Order ${requested.orderId} (${requested.side}) already has an in-flight ${blocking.action.action} ` +
          `submission (${blocking.status}${blocking.txHash ? `, tx ${blocking.txHash}` : ''}); ` +
          `refusing ${requested.action}`;
  }
}

/** A deterministic refusal that must never be retried. */
export class RelayRefusalError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'RelayRefusalError';
    this.code = code;
  }
}

const DEFAULTS = {
  maxAttempts: 3,
  timeoutMs: 30_000,
  retryDelayMs: 2_000,
  pollIntervalMs: 5_000,
  backoff: true,
};

/** Current on-disk schema version for {@link PersistedSubmission}. */
export const PERSISTENCE_VERSION = 1;

/**
 * Decide what a persisted record is worth after a restart.
 *
 * `in_flight` is never trusted across a restart: the two-phase contract
 * guarantees nothing was broadcast before a hash was recorded, so a record
 * without one cannot represent a live transaction. Downgrading it to `failed`
 * releases the order lock for the recovery path instead of wedging the order
 * forever. `pending` without a hash is unusable for the same reason.
 */
function normalizePersistedStatus(
  status: unknown,
  txHash: string | undefined,
  lastError: string | undefined
): { status: RelayStatus; lastError?: string } {
  if (status === 'succeeded' || status === 'failed') return { status, lastError };
  if (status === 'in_flight') {
    return { status: 'failed', lastError: 'relayer restarted before a transaction hash was recorded' };
  }
  if (status === 'pending') {
    return txHash
      ? { status: 'pending', lastError }
      : { status: 'failed', lastError: 'pending record without a transaction hash; discarded' };
  }
  return { status: 'failed', lastError: `unknown persisted status ${String(status)}; discarded` };
}

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

/** Stable, order-independent serialization used for the order-lock digest. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function shortDigest(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

/** Keep log lines and store keys readable without ever losing the raw id. */
function humanizeOrderId(orderId: string): string {
  const safe = String(orderId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return safe || 'unknown';
}

/**
 * Single-flight scope for an order. One claim or one refund, never both, for a
 * given (orderId, side) pair. The digest of the raw order id keeps two ids that
 * only differ in characters we sanitised apart.
 */
export function computeOrderKey(orderId: string, side: RelaySide): string {
  return `${humanizeOrderId(orderId)}|${side}#${shortDigest(String(orderId ?? ''))}`;
}

/**
 * Compute the deterministic submission key (idempotency key) for an action.
 * Derived from the order id, the side, and the action only — deliberately not
 * from the amount, destination, or `extra`, because a re-priced or
 * re-derived attempt of the *same* action must land in the same slot.
 */
export function computeSubmissionKey(action: RelayAction): string {
  return `${action.side}:${action.action}:${humanizeOrderId(action.orderId)}#${shortDigest(
    stableStringify(String(action.orderId ?? ''))
  )}`;
}

/** JSON-safe projection of a record for the store. */
export function toPersistedSubmission(record: SubmissionRecord): PersistedSubmission {
  return {
    version: PERSISTENCE_VERSION,
    key: record.key,
    orderKey: record.orderKey,
    orderId: record.action.orderId,
    side: record.action.side,
    action: record.action.action,
    chain: record.action.chain,
    network: record.network ?? record.action.network,
    txHash: record.txHash,
    status: record.status,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    broadcasts: record.broadcasts,
    lastError: record.lastError,
    terminalReason: record.terminalReason,
    result: serializableResult(record.result),
    firstSeenAt: record.firstSeenAt,
    lastAttemptAt: record.lastAttemptAt,
    completedAt: record.completedAt,
  };
}

/**
 * Best-effort JSON projection of a result. Ethers receipts and Stellar
 * responses carry BigInts and provider internals; a store that cannot encode
 * the value stores `undefined` rather than throwing, because losing the cached
 * body is always preferable to losing the record.
 */
function serializableResult(result: unknown): unknown {
  if (result === undefined) return undefined;
  try {
    return JSON.parse(
      JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
    );
  } catch {
    return undefined;
  }
}

export class RelaySubmissionTracker {
  private readonly records = new Map<string, SubmissionRecord>();
  /** Keys with a reconciler currently polling them. Prevents poll fan-out. */
  private readonly reconciling = new Set<string>();
  /** Keys with an operation currently running, so overlapping callers join it. */
  private readonly inflight = new Map<string, Promise<RelayOutcome<unknown>>>();
  private readonly cfg: Required<Omit<RelayTrackerConfig, 'onEvent' | 'logger' | 'store' | 'confirm'>> &
    Pick<RelayTrackerConfig, 'onEvent' | 'logger' | 'store' | 'confirm'>;
  private duplicatesSkipped = 0;
  private inFlightSkipped = 0;
  private orderBlocked = 0;
  private restoredCount = 0;
  private storeErrors = 0;

  constructor(config: RelayTrackerConfig = {}) {
    const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? DEFAULTS.maxAttempts));
    this.cfg = {
      maxAttempts,
      timeoutMs: config.timeoutMs ?? DEFAULTS.timeoutMs,
      retryDelayMs: config.retryDelayMs ?? DEFAULTS.retryDelayMs,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      backoff: config.backoff ?? DEFAULTS.backoff,
      isRetryable: config.isRetryable ?? (() => true),
      now: config.now ?? Date.now,
      sleep: config.sleep ?? defaultSleep,
      confirm: config.confirm,
      store: config.store,
      onEvent: config.onEvent,
      logger: config.logger,
    };
    if (this.cfg.store) this.restore();
  }

  /** Total attempts allowed per submission (the confirmation budget). */
  get maxAttempts(): number {
    return this.cfg.maxAttempts;
  }

  key(action: RelayAction): string {
    return computeSubmissionKey(action);
  }

  getRecord(actionOrKey: RelayAction | string): SubmissionRecord | undefined {
    const key = typeof actionOrKey === 'string' ? actionOrKey : computeSubmissionKey(actionOrKey);
    return this.records.get(key);
  }

  /** Whether an action has already reached terminal success. */
  isHandled(action: RelayAction): boolean {
    return this.getRecord(action)?.status === 'succeeded';
  }

  /**
   * Whether the order currently has a non-terminal or settled submission that
   * would refuse a *different* action. Callers that need a cheap guard (e.g.
   * the refund watchdog) can use this instead of catching an error.
   */
  getBlockingRecord(action: RelayAction): SubmissionRecord | undefined {
    const orderKey = computeOrderKey(action.orderId, action.side);
    const key = computeSubmissionKey(action);
    for (const record of this.records.values()) {
      if (record.orderKey !== orderKey) continue;
      if (record.key === key) continue;
      if (record.status === 'failed') continue;
      return record;
    }
    return undefined;
  }

  /**
   * Submit a relay action exactly once, with a bounded retry budget.
   *
   * - If the action already succeeded, the stored result is returned and the
   *   stager is NOT run again (duplicate prevention, restart safe).
   * - If the action previously failed terminally, {@link RelayTerminalError} is
   *   thrown without re-running the stager.
   * - If a submission for the same key is already running, the caller joins it
   *   and receives the *same* hash — overlapping attempts cannot fan out.
   * - If a *different* action for the same order owns the single-flight lock,
   *   {@link RelayOrderBusyError} is thrown and nothing is broadcast.
   * - Otherwise the stager runs once, its `txHash` + `network` + `status` are
   *   persisted, and only then is the broadcast invoked. If the broadcast fails
   *   or times out, the retry budget is spent polling that stored hash through
   *   `confirm` — the stager is never called a second time.
   */
  async submit<R>(action: RelayAction, stager: RelayStager<R>): Promise<RelayOutcome<R>> {
    const key = computeSubmissionKey(action);
    const existing = this.records.get(key) as SubmissionRecord<R> | undefined;

    if (existing) {
      if (existing.status === 'succeeded') {
        this.duplicatesSkipped++;
        this.emit('duplicate_skipped', existing);
        this.cfg.logger?.log?.(
          `↪️  Relay ${key} already settled (tx ${existing.txHash ?? 'unknown'}); not resubmitting`
        );
        return {
          status: 'already_handled',
          result: existing.result as R,
          record: existing,
          duplicate: true,
          txHash: existing.txHash,
          network: existing.network,
        };
      }
      if (existing.status === 'failed') {
        // A staging failure is provably pre-broadcast: no hash was ever
        // recorded, so nothing can be on-chain. Release the slot and let the
        // next caller re-stage instead of tombstoning the order forever (a
        // transient Horizon hiccup must not permanently disable a refund).
        if (existing.terminalReason === 'staging_failed') {
          this.cfg.logger?.log?.(
            `↻  Relay ${key} never reached the network (${existing.lastError}); re-staging`
          );
          this.records.delete(key);
          this.persist();
          this.assertOrderAvailable(action, key);
          return this.submit(action, stager);
        }
        this.emit('terminal_failure', existing);
        throw new RelayTerminalError(
          key,
          existing.attempts,
          existing.lastError,
          existing.terminalReason ?? 'failed'
        );
      }

      // Another caller is already driving this key. Join it so overlapping
      // attempts converge on one hash instead of racing each other.
      const running = this.inflight.get(key) as Promise<RelayOutcome<R>> | undefined;
      if (running) {
        this.inFlightSkipped++;
        this.emit('in_flight_skipped', existing);
        const settled = await running;
        return { ...settled, status: 'already_handled', duplicate: true };
      }

      if (existing.status === 'in_flight') {
        // Reserved but no hash recorded and nobody is driving it: only reachable
        // from a store that was tampered with, since `restore` downgrades these.
        this.inFlightSkipped++;
        this.emit('in_flight_skipped', existing);
        throw new RelayInFlightError(key);
      }
      // status === 'pending': a hash exists. Attach to it instead of broadcasting.
      return this.track(key, () => this.reconcile(existing, { duplicate: true }));
    }

    this.assertOrderAvailable(action, key);

    const record: SubmissionRecord<R> = {
      key,
      orderKey: computeOrderKey(action.orderId, action.side),
      action,
      status: 'in_flight',
      attempts: 0,
      maxAttempts: this.cfg.maxAttempts,
      broadcasts: 0,
      firstSeenAt: this.cfg.now(),
    };
    this.records.set(key, record as SubmissionRecord);
    this.persist();

    return this.track(key, () => this.broadcastOnce(record, stager));
  }

  /**
   * Register the in-flight operation for a key so overlapping callers join it
   * rather than starting a second one.
   */
  private track<R>(key: string, run: () => Promise<RelayOutcome<R>>): Promise<RelayOutcome<R>> {
    const promise = run();
    this.inflight.set(key, promise as Promise<RelayOutcome<unknown>>);
    const clear = () => {
      if (this.inflight.get(key) === (promise as Promise<RelayOutcome<unknown>>)) {
        this.inflight.delete(key);
      }
    };
    promise.then(clear, clear);
    return promise;
  }

  /**
   * Stage, persist, then broadcast — exactly once for the lifetime of the key.
   */
  private async broadcastOnce<R>(
    record: SubmissionRecord<R>,
    stager: RelayStager<R>
  ): Promise<RelayOutcome<R>> {
    record.attempts++;
    record.lastAttemptAt = this.cfg.now();
    this.emit('attempt', record);

    let staged: StagedSubmission<R>;
    try {
      staged = await withTimeout(
        (async () => stager())(),
        this.cfg.timeoutMs,
        `Relay ${record.key} staging timed out after ${this.cfg.timeoutMs}ms`
      );
    } catch (err) {
      record.lastError = errorMessage(err);
      const retryable = this.cfg.isRetryable(err);
      this.fail(record, retryable ? 'staging_failed' : 'non_retryable');
      this.cfg.logger?.error?.(`❌ Relay ${record.key} could not be staged: ${record.lastError}`);
      throw new RelayTerminalError(record.key, record.attempts, record.lastError, retryable ? 'staging_failed' : 'non_retryable');
    }

    // Invariant guard: the two-phase contract exists so the hash is known
    // before the transaction can land. Without it we could never reconcile.
    if (!staged || typeof staged.txHash !== 'string' || staged.txHash.length === 0) {
      record.lastError = 'stager did not provide a transaction hash before broadcast';
      this.fail(record, 'staging_failed');
      throw new RelayTerminalError(record.key, record.attempts, record.lastError, 'staging_failed');
    }

    // ── Hash-first: everything below this line is recoverable from disk. ──
    record.txHash = staged.txHash;
    record.network = staged.network ?? record.action.network;
    record.status = 'pending';
    record.broadcasts++;
    this.persist();
    this.emit('broadcast', record);
    this.cfg.logger?.log?.(
      `📤 Relay ${record.key} broadcasting tx ${record.txHash} on ${record.network ?? record.action.chain}`
    );

    try {
      const result = await withTimeout(
        staged.broadcast(),
        this.cfg.timeoutMs,
        `Relay ${record.key} timed out after ${this.cfg.timeoutMs}ms (tx ${record.txHash})`
      );
      return this.settleSuccess(record, result, { duplicate: false, reconciled: false });
    } catch (err) {
      // Ambiguous outcome: the transaction may or may not be on-chain. Do not
      // broadcast again — attach the retry to the stored hash.
      record.lastError = errorMessage(err);
      this.persist();
      this.emit('retry', record);
      this.cfg.logger?.warn?.(
        `⚠️  Relay ${record.key} broadcast did not confirm (${record.lastError}); ` +
          `reconciling tx ${record.txHash} instead of resubmitting`
      );
      return this.reconcile(record, { duplicate: false });
    }
  }

  /**
   * Drive a stored hash to a terminal state, spending this call's retry budget
   * on polls. Never calls the stager or the broadcast closure.
   *
   * The budget is per call, not per record: an operator (or the watchdog)
   * coming back later gets a fresh polling window instead of inheriting an
   * exhausted counter. That cannot cause a second transaction — polling is a
   * read against a single stored hash.
   */
  private async reconcile<R>(
    record: SubmissionRecord<R>,
    outcome: { duplicate: boolean }
  ): Promise<RelayOutcome<R>> {
    if (!this.cfg.confirm) {
      // Without a confirmer we cannot prove the transaction is safe to replace.
      // Stay `pending` so the order lock is held and nothing else broadcasts.
      this.emit('confirmation_timeout', record);
      throw new RelayConfirmationTimeoutError(record.key, record.txHash, record.network, record.attempts);
    }
    if (this.reconciling.has(record.key)) {
      this.inFlightSkipped++;
      this.emit('in_flight_skipped', record);
      throw new RelayInFlightError(record.key);
    }

    this.reconciling.add(record.key);
    let lastState: RelayConfirmationState = 'pending';
    let polls = 0;
    try {
      while (polls < this.cfg.maxAttempts) {
        polls++;
        record.attempts++;
        record.lastAttemptAt = this.cfg.now();

        let confirmation: RelayConfirmation;
        try {
          confirmation = await this.cfg.confirm(this.confirmationRef(record));
        } catch (err) {
          // A flaky RPC is not evidence either way — keep polling.
          confirmation = { state: 'pending', error: errorMessage(err) };
        }
        lastState = confirmation.state;

        if (confirmation.state === 'succeeded') {
          return this.settleSuccess(record, (confirmation.result ?? record.result) as R, {
            duplicate: outcome.duplicate,
            reconciled: true,
          });
        }
        if (confirmation.state === 'failed') {
          record.lastError = confirmation.error ?? 'transaction failed on chain';
          this.fail(record, 'failed');
          this.cfg.logger?.error?.(
            `❌ Relay ${record.key} tx ${record.txHash} failed on chain: ${record.lastError}`
          );
          throw new RelayTerminalError(record.key, record.attempts, record.lastError, 'failed');
        }

        record.lastError =
          confirmation.state === 'not_found'
            ? `tx ${record.txHash} was never observed on ${record.network ?? record.action.chain}`
            : confirmation.error ?? `tx ${record.txHash} still pending`;
        this.persist();
        this.emit('confirmation_pending', record);

        if (polls >= this.cfg.maxAttempts) break;
        await this.cfg.sleep(this.pollDelayFor(polls));
      }

      // Budget exhausted.
      if (lastState === 'not_found') {
        // Nothing was ever observed on any node we polled, so no funds moved.
        // Release the order lock so the recovery path can take over.
        this.fail(record, 'not_found');
        this.cfg.logger?.error?.(`❌ Relay ${record.key}: ${record.lastError}`);
        throw new RelayTerminalError(record.key, record.attempts, record.lastError, 'not_found');
      }

      // The transaction is live but unconfirmed. Keep the record `pending` so
      // the order lock is held and no refund can race this submission.
      this.emit('confirmation_timeout', record);
      this.persist();
      this.cfg.logger?.warn?.(
        `⚠️  Relay ${record.key} tx ${record.txHash} still unconfirmed after ${record.attempts} attempt(s); order lock held`
      );
      throw new RelayConfirmationTimeoutError(record.key, record.txHash, record.network, record.attempts);
    } finally {
      this.reconciling.delete(record.key);
    }
  }

  private settleSuccess<R>(
    record: SubmissionRecord<R>,
    result: R,
    outcome: { duplicate: boolean; reconciled: boolean }
  ): RelayOutcome<R> {
    record.status = 'succeeded';
    record.result = result;
    record.completedAt = this.cfg.now();
    delete record.lastError;
    this.persist();
    this.emit('success', record);
    this.cfg.logger?.log?.(
      `✅ Relay ${record.key} settled (tx ${record.txHash ?? 'unknown'}) after ${record.attempts} attempt(s)`
    );
    return {
      status: outcome.duplicate ? 'already_handled' : 'succeeded',
      result,
      record,
      duplicate: outcome.duplicate,
      txHash: record.txHash,
      network: record.network,
      reconciled: outcome.reconciled,
    };
  }

  private fail<R>(record: SubmissionRecord<R>, reason: RelayTerminalReason): void {
    record.status = 'failed';
    record.completedAt = this.cfg.now();
    record.terminalReason = reason;
    record.lastError = record.lastError ?? `relay submission ${reason}`;
    this.persist();
    this.emit('terminal_failure', record);
  }

  /**
   * Refuse a second *action* for an order that already has a live or settled
   * submission. A terminally failed submission releases the order lock so the
   * recovery path (typically a refund) can proceed.
   */
  private assertOrderAvailable(action: RelayAction, key: string): void {
    const blocking = this.getBlockingRecord(action);
    if (!blocking) return;
    this.orderBlocked++;
    this.emit('order_busy', blocking, { requested: action, key });
    this.cfg.logger?.warn?.(`🚫 ${new RelayOrderBusyError(action, blocking).message}`);
    throw new RelayOrderBusyError(action, blocking);
  }

  private confirmationRef(record: SubmissionRecord): RelayConfirmationRef {
    return {
      key: record.key,
      orderKey: record.orderKey,
      txHash: record.txHash as string,
      chain: record.action.chain,
      network: record.network ?? record.action.network,
      orderId: record.action.orderId,
      side: record.action.side,
      action: record.action.action,
      attempt: record.attempts,
      maxAttempts: record.maxAttempts,
    };
  }

  private pollDelayFor(attempt: number): number {
    if (!this.cfg.backoff) return this.cfg.pollIntervalMs;
    return this.cfg.pollIntervalMs * Math.pow(2, Math.max(0, attempt - 1));
  }

  private delayFor(attempt: number): number {
    if (!this.cfg.backoff) return this.cfg.retryDelayMs;
    return this.cfg.retryDelayMs * Math.pow(2, attempt - 1);
  }

  private emit(
    type: RelayTrackerEventType,
    record: SubmissionRecord,
    extra?: { requested?: RelayAction; key?: string }
  ): void {
    this.cfg.onEvent?.({
      type,
      key: record.key,
      orderKey: record.orderKey,
      action: extra?.requested ?? record.action,
      attempt: record.attempts,
      maxAttempts: record.maxAttempts,
      txHash: record.txHash,
      network: record.network,
      blockingKey: type === 'order_busy' ? record.key : undefined,
      error: record.lastError,
    });
  }

  /**
   * Re-read the store and rehydrate records. Called automatically when a store
   * is configured; call it again to pick up records written by another process.
   *
   * Rehydration rules:
   *  - `succeeded` records are restored so a confirmed hash is never resubmitted.
   *  - `pending` records are restored as `pending` so the next `submit()` polls
   *    the stored hash instead of broadcasting again.
   *  - `in_flight` records (no hash was ever persisted) are restored as
   *    `failed`: the two-phase contract guarantees nothing was broadcast
   *    without a recorded hash, so the order lock is released for recovery.
   */
  restore(): number {
    const store = this.cfg.store;
    if (!store) return 0;
    let loaded: PersistedSubmission[] = [];
    try {
      loaded = store.load() ?? [];
    } catch (err) {
      this.storeErrors++;
      this.cfg.logger?.error?.('❌ Relay submission store could not be read:', errorMessage(err));
      return 0;
    }

    let restored = 0;
    for (const entry of loaded) {
      if (!entry || typeof entry.key !== 'string' || !entry.key) continue;
      const action: RelayAction = {
        orderId: String(entry.orderId ?? ''),
        side: (entry.side ?? 'unknown') as RelaySide,
        action: (entry.action ?? 'unknown') as RelayActionName,
        chain: (entry.chain ?? 'unknown') as RelayChain,
        network: entry.network,
      };
      const { status, lastError } = normalizePersistedStatus(entry.status, entry.txHash, entry.lastError);
      // A staging failure is pre-broadcast, so it stays re-stageable after a
      // restart too. Everything else that failed is a tombstone.
      const terminalReason =
        status === 'failed' && (entry.terminalReason === 'staging_failed' || !entry.txHash)
          ? 'staging_failed'
          : entry.terminalReason;

      this.records.set(entry.key, {
        key: entry.key,
        orderKey: entry.orderKey || computeOrderKey(action.orderId, action.side),
        action,
        status,
        attempts: Number.isFinite(entry.attempts) ? Number(entry.attempts) : 0,
        maxAttempts: Number.isFinite(entry.maxAttempts) ? Number(entry.maxAttempts) : this.cfg.maxAttempts,
        broadcasts: Number.isFinite(entry.broadcasts)
          ? Number(entry.broadcasts)
          : entry.txHash
            ? 1
            : 0,
        txHash: entry.txHash,
        network: entry.network,
        lastError,
        terminalReason,
        result: entry.result,
        firstSeenAt: Number.isFinite(entry.firstSeenAt) ? Number(entry.firstSeenAt) : this.cfg.now(),
        lastAttemptAt: entry.lastAttemptAt,
        completedAt: entry.completedAt,
        restored: true,
      });
      restored++;
    }

    this.restoredCount += restored;
    if (restored > 0) {
      const settled = Array.from(this.records.values()).filter(r => r.restored && r.status === 'succeeded').length;
      const pending = Array.from(this.records.values()).filter(r => r.restored && r.status === 'pending').length;
      this.cfg.logger?.log?.(
        `♻️  Relay submission store restored ${restored} record(s) (${settled} settled, ${pending} awaiting confirmation)`
      );
      this.cfg.onEvent?.({
        type: 'restored',
        key: '*',
        action: { orderId: '', side: 'unknown', action: 'unknown', chain: 'unknown' },
        attempt: 0,
        maxAttempts: this.cfg.maxAttempts,
      });
    }
    return restored;
  }

  getStats(): RelayTrackerStats {
    let inFlight = 0;
    let pendingConfirmations = 0;
    let succeeded = 0;
    let failed = 0;
    let totalAttempts = 0;
    let retries = 0;
    let broadcasts = 0;
    for (const r of this.records.values()) {
      if (r.status === 'in_flight') inFlight++;
      else if (r.status === 'pending') pendingConfirmations++;
      else if (r.status === 'succeeded') succeeded++;
      else if (r.status === 'failed') failed++;
      totalAttempts += r.attempts;
      broadcasts += r.broadcasts;
      if (r.attempts > 1) retries += r.attempts - 1;
    }
    return {
      tracked: this.records.size,
      inFlight,
      pendingConfirmations,
      succeeded,
      failed,
      totalAttempts,
      retries,
      broadcasts,
      duplicatesSkipped: this.duplicatesSkipped,
      inFlightSkipped: this.inFlightSkipped,
      orderBlocked: this.orderBlocked,
      restored: this.restoredCount,
      storeErrors: this.storeErrors,
    };
  }

  /** Snapshot of all tracked records, newest first. */
  list(): SubmissionRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  }

  /**
   * Drop a single record to allow a manual re-submission.
   *
   * `succeeded` and `pending` records are refused by default: forgetting them
   * would release the order lock and re-open the double-spend window this
   * tracker exists to close. Operators must pass `{ force: true }` to override
   * (e.g. after independently proving on-chain that the transaction died).
   */
  forget(actionOrKey: RelayAction | string, options: { force?: boolean } = {}): boolean {
    const key = typeof actionOrKey === 'string' ? actionOrKey : computeSubmissionKey(actionOrKey);
    const record = this.records.get(key);
    if (!record) return false;
    if (!options.force && (record.status === 'succeeded' || record.status === 'pending')) {
      this.cfg.logger?.warn?.(
        `🚫 Refusing to forget ${key}: ${record.status} submissions hold the order lock (pass { force: true } to override)`
      );
      return false;
    }
    this.records.delete(key);
    this.persist();
    return true;
  }

  /** Clear all tracked state and the store. Primarily for tests. */
  reset(): void {
    this.records.clear();
    this.reconciling.clear();
    this.inflight.clear();
    this.duplicatesSkipped = 0;
    this.inFlightSkipped = 0;
    this.orderBlocked = 0;
    this.restoredCount = 0;
    this.storeErrors = 0;
    this.persist();
  }

  /** Write the current snapshot to the store. Never throws. */
  private persist(): void {
    const store = this.cfg.store;
    if (!store) return;
    try {
      store.save(Array.from(this.records.values()).map(toPersistedSubmission));
    } catch (err) {
      // Losing durability must never abort an in-flight settlement.
      this.storeErrors++;
      this.cfg.logger?.error?.('❌ Relay submission store write failed:', errorMessage(err));
    }
  }
}
