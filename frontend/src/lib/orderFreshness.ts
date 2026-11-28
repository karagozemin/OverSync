/**
 * orderFreshness.ts
 *
 * Pure helper that classifies how "fresh" a pending cross-chain order is,
 * based on how long it has spent in each lifecycle stage.
 *
 * Classification ladder (mutually exclusive, checked in priority order):
 *
 *   fresh         – progressing normally, nothing to surface to the user
 *   pending       – a bit slower than expected but within tolerance
 *   stale         – stuck longer than expected; show a calm "check back" hint
 *   refund-soon   – timelock is approaching expiry; remind the user they CAN refund
 *   refund-eligible – timelock has passed; user can refund right now
 *
 * Terminal statuses (completed / refunded / failed / cancelled) always return
 * "fresh" so the banner never renders on finished orders.
 *
 * All thresholds are in milliseconds and are intentionally conservative:
 * cross-chain swaps legitimately take a few minutes, so we wait long enough
 * before flagging anything.
 *
 * No RPC calls are made here. All inputs come from coordinator API fields.
 */

import { fetchOrderById, type RecoveredOrder } from './orderRecovery';

export type FreshnessLabel =
  | 'fresh'
  | 'pending'
  | 'stale'
  | 'refund-soon'
  | 'refund-eligible';

export interface FreshnessResult {
  label: FreshnessLabel;
  /** Short hint to display alongside the order. Empty string for "fresh". */
  hint: string;
}

// ─── Tuneable thresholds ────────────────────────────────────────────────────

/** Orders progressing normally — nothing to show. */
export const FRESH_THRESHOLD_MS = 3 * 60 * 1_000; // 3 min

/** Slightly slow — surface a "still processing" note without alarm. */
export const PENDING_THRESHOLD_MS = 8 * 60 * 1_000; // 8 min

/** Clearly stuck — show a next-step hint. */
export const STALE_THRESHOLD_MS = 20 * 60 * 1_000; // 20 min

/**
 * When a timelock is this close to expiry, remind the user they can refund
 * once it does (without saying the swap failed).
 */
export const REFUND_SOON_WINDOW_MS = 15 * 60 * 1_000; // 15 min before expiry

// ─── Terminal statuses that should never show a banner ──────────────────────

const TERMINAL_STATUSES = new Set([
  'completed',
  'refunded',
  'failed',
  'cancelled', // UI-side alias for refunded
]);

// ─── Public API ─────────────────────────────────────────────────────────────

export interface OrderFreshnessInput {
  /**
   * Coordinator / UI status for this order.
   * Accepts both coordinator statuses (e.g. "src_locked") and the simplified
   * UI statuses used in TransactionHistory ("pending", "completed", etc.).
   */
  status: string;

  /**
   * Unix epoch in milliseconds when the order was last updated by the
   * coordinator. Corresponds to `updatedAt` from the orders API.
   */
  updatedAt: number;

  /**
   * Current wall-clock time in milliseconds (Date.now()).
   * Passed explicitly so callers / tests can control it without mocking globals.
   */
  nowMs: number;

  /**
   * Optional: UNIX timestamp in *seconds* when the source-side timelock
   * expires. Populated from `src.timelock` in the coordinator API response.
   * If absent, refund-soon / refund-eligible logic is skipped.
   */
  timelockUnixSeconds?: number;
}

/**
 * Classify an order's freshness.
 *
 * Returns `{ label: 'fresh', hint: '' }` for terminal or fast-moving orders
 * so callers can gate on `label !== 'fresh'` without extra null checks.
 */
export function classifyOrderFreshness(input: OrderFreshnessInput): FreshnessResult {
  const { status, updatedAt, nowMs, timelockUnixSeconds } = input;

  // Terminal orders never get a stale banner
  if (TERMINAL_STATUSES.has(status)) {
    return fresh();
  }

  // ── Refund-eligible: timelock has already passed ─────────────────────────
  if (timelockUnixSeconds !== undefined) {
    const timelockMs = timelockUnixSeconds * 1_000;

    if (nowMs >= timelockMs) {
      return {
        label: 'refund-eligible',
        hint: 'Timelock expired. You can request a refund now.',
      };
    }

    // ── Refund-soon: timelock expiring within the warning window ─────────
    if (timelockMs - nowMs <= REFUND_SOON_WINDOW_MS) {
      const minutesLeft = Math.ceil((timelockMs - nowMs) / 60_000);
      return {
        label: 'refund-soon',
        hint: `Timelock expires in ~${minutesLeft} min. If the swap doesn't complete, you'll be able to refund.`,
      };
    }
  }

  // ── Age-based classification ─────────────────────────────────────────────
  const ageMs = nowMs - updatedAt;

  if (ageMs < FRESH_THRESHOLD_MS) {
    return fresh();
  }

  if (ageMs < PENDING_THRESHOLD_MS) {
    return {
      label: 'pending',
      hint: 'Still processing — cross-chain swaps can take a few minutes.',
    };
  }

  if (ageMs < STALE_THRESHOLD_MS) {
    return {
      label: 'stale',
      hint: 'Taking longer than expected. Check back soon or refresh to get the latest status.',
    };
  }

  // Beyond STALE_THRESHOLD_MS
  return {
    label: 'stale',
    hint: 'This order has been pending for a while. Try refreshing, or contact support if you need help.',
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function fresh(): FreshnessResult {
  return { label: 'fresh', hint: '' };
}

export interface OrderFreshnessOptions {
  now?: number;
  maxAgeMs?: number;
  baseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Checks whether an order is stale.
 *
 * An order is considered stale if:
 * 1. It explicitly carries `isStale = true` or `stale = true`.
 * 2. The coordinator has marked its status as 'expired'.
 * 3. The coordinator has marked its status as 'failed'.
 * 4. Its timelock has passed and the order has not reached terminal 'completed'.
 * 5. It has exceeded maxAgeMs without being updated.
 */
export function isOrderStale(
  order: RecoveredOrder | null | undefined,
  options?: OrderFreshnessOptions
): boolean {
  if (!order) return false;

  // Explicit staleness flag
  if (order.isStale === true || (order as any).stale === true) {
    return true;
  }

  // Soft/terminal expired status from coordinator
  if (order.status === 'expired') {
    return true;
  }

  // Failed state is also stale/unactionable
  if (order.status === 'failed') {
    return true;
  }

  const now = options?.now ?? Date.now();

  // Check timelock expiration on source or destination leg
  const srcTimelock = order.src?.timelock;
  if (srcTimelock && srcTimelock > 0) {
    const srcTimelockMs = srcTimelock > 1e11 ? srcTimelock : srcTimelock * 1000;
    if (now >= srcTimelockMs && order.status !== 'completed') {
      return true;
    }
  }

  const dstTimelock = order.dst?.timelock;
  if (dstTimelock && dstTimelock > 0) {
    const dstTimelockMs = dstTimelock > 1e11 ? dstTimelock : dstTimelock * 1000;
    if (now >= dstTimelockMs && order.status !== 'completed') {
      return true;
    }
  }

  // Check optional age limit if provided
  if (options?.maxAgeMs && order.updatedAt) {
    const updatedAtMs = order.updatedAt > 1e11 ? order.updatedAt : order.updatedAt * 1000;
    if (now - updatedAtMs > options.maxAgeMs) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies freshness of an order by polling the coordinator API.
 * Returns the fresh order and whether it is stale.
 * If the request fails, the caller can catch the error, keep the restored order
 * visible, and provide an explicit retry trigger.
 */
export async function checkOrderFreshness(
  orderId: string,
  options?: OrderFreshnessOptions
): Promise<{ order: RecoveredOrder; isStale: boolean }> {
  const order = await fetchOrderById(orderId, {
    baseUrl: options?.baseUrl,
    signal: options?.signal,
  });

  if (!order) {
    throw new Error(`Order ${orderId} was not found on the coordinator.`);
  }

  const isStale = isOrderStale(order, options);
  return { order, isStale };
}

