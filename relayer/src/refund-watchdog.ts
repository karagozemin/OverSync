/**
 * Background watchdog that rescues XLM→ETH orders the relayer failed to
 * complete (typically because the user closed the page after sending
 * XLM, or the ETH RPC hiccupped past the in-request retry budget).
 *
 * Every `intervalMs` we walk `activeOrders`, find any `xlm_to_eth` order
 * that has been awaiting ETH for longer than `staleAfterMs`, and trigger
 * a refund using the same code path as the inline handler. Refunded
 * orders are stamped `refunded` (and `refundTxHash`) so subsequent ticks
 * don't double-pay.
 *
 * The watchdog is best-effort: failures are logged but never thrown so
 * one bad order can't take down the entire timer.
 */

import { redactLogValue } from '@oversync/sdk/logging';
import { refundXlmToUser, type RefundNetworkMode } from './xlm-refund.js';

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_STALE_AFTER_MS = 5 * 60_000; // 5 minutes

interface WatchdogOrder {
  orderId?: string;
  direction?: string;
  status?: string;
  stellarAddress?: string;
  stellarTxHash?: string;
  xlmReceivedAt?: number | string;
  created?: number | string;
  amount?: number | string;
  networkMode?: RefundNetworkMode | string;
  refundTxHash?: string;
  refundedAt?: number;
  watchdogFailedAt?: number;
  watchdogFailureReason?: string;
  [k: string]: unknown;
}

export interface WatchdogConfig {
  /** How often to scan, in ms. Defaults to 60s. */
  intervalMs?: number;
  /**
   * How long an order can sit without ETH being sent before the
   * watchdog refunds it. Defaults to 5 minutes.
   */
  staleAfterMs?: number;
  /** Horizon URL for the active Stellar network (mainnet or testnet). */
  horizonUrl: string;
  /** Stellar secret the relayer will sign refunds with. */
  refundSecret: string;
  /** Network mode used to choose the right passphrase. */
  networkMode: RefundNetworkMode;
  /**
   * Reference to the in-memory order map maintained by the relayer.
   * The watchdog mutates entries in-place to mark them refunded.
   */
  activeOrders: Map<string, WatchdogOrder>;
}

function toMillis(value: WatchdogOrder['xlmReceivedAt'] | WatchdogOrder['created']): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isXlmToEthAwaitingEth(order: WatchdogOrder): boolean {
  if (order.direction !== 'xlm_to_eth') return false;
  if (!order.stellarTxHash) return false; // XLM never received → nothing to refund
  if (order.refundTxHash || order.refundedAt) return false; // already refunded
  if (order.status === 'eth_tx_sent' || order.status === 'completed') return false;
  if (order.status === 'refunded') return false;
  return true;
}

export function startRefundWatchdog(config: WatchdogConfig): { stop: () => void } {
  const intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  const staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  console.log(
    `[refund-watchdog] starting · scan every ${Math.round(intervalMs / 1000)}s · refund after ${Math.round(staleAfterMs / 1000)}s · network=${config.networkMode}`
  );

  const tick = async () => {
    const now = Date.now();
    for (const [orderId, order] of config.activeOrders.entries()) {
      try {
        if (!isXlmToEthAwaitingEth(order)) continue;
        if (order.watchdogFailedAt && now - order.watchdogFailedAt < 10 * 60_000) {
          // back off for 10 minutes after a failed attempt
          continue;
        }

        const startedAt = toMillis(order.xlmReceivedAt) ?? toMillis(order.created);
        if (!startedAt) continue;
        const age = now - startedAt;
        if (age < staleAfterMs) continue;

        const stellarAddress = order.stellarAddress;
        if (!stellarAddress) {
          console.warn(`[refund-watchdog] order ${orderId} stuck but missing stellarAddress; skipping`);
          continue;
        }

        console.log(
          `[refund-watchdog] refunding ${orderId} — pending for ${Math.round(age / 1000)}s, stellarTx=${order.stellarTxHash}`
        );

        const refund = await refundXlmToUser({
          orderId,
          stellarAddress,
          stellarTxHash: order.stellarTxHash,
          networkMode: config.networkMode,
          horizonUrl: config.horizonUrl,
          refundSecret: config.refundSecret,
          fallbackXlmAmount: order.amount ? String(order.amount) : undefined,
        });

        order.status = 'refunded';
        order.refundTxHash = refund.hash;
        order.refundedAt = Date.now();
        console.log(
          `[refund-watchdog] ✅ refunded ${refund.amount} XLM → ${stellarAddress} (tx=${refund.hash})`
        );
      } catch (err: any) {
        order.watchdogFailedAt = Date.now();
        order.watchdogFailureReason = err?.message ?? String(err);
        console.error(`[refund-watchdog] failed to refund ${orderId}:`, redactLogValue(err?.message ?? err));
      }
    }
  };

  // Fire-and-forget first scan after a short warm-up so the watchdog
  // doesn't race with relayer startup logic.
  const warmup = setTimeout(() => { void tick(); }, 15_000);
  const handle = setInterval(() => { void tick(); }, intervalMs);

  return {
    stop() {
      clearTimeout(warmup);
      clearInterval(handle);
    },
  };
}
