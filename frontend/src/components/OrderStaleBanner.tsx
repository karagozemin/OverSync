import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FreshnessResult } from '../lib/orderFreshness';
import type { RecoveredOrder } from '../lib/orderRecovery';

export interface OrderStaleBannerProps {
  /** Pre-classified freshness for a transaction row (TransactionHistory). */
  freshness?: FreshnessResult;
  /** Restored order whose freshness could not be verified (BridgeForm). */
  order?: RecoveredOrder | null;
  isStale?: boolean;
  freshnessError?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
}

/**
 * OrderStaleBanner
 *
 * Renders a small, non-blocking status hint beneath a transaction row when an
 * order is taking longer than expected. Returns null for fresh/terminal orders
 * so callers can render this unconditionally.
 *
 * Two call sites share this banner:
 *   - TransactionHistory passes a pre-classified `freshness` result.
 *   - BridgeForm passes the restored order's `isStale` / `freshnessError`.
 */
export default function OrderStaleBanner({
  freshness,
  order: _order,
  isStale = false,
  freshnessError = null,
  onRetry,
  isRetrying = false,
}: OrderStaleBannerProps) {
  if (freshness) {
    if (freshness.label === 'fresh') return null;
    return <FreshnessHint freshness={freshness} />;
  }

  if (!isStale && !freshnessError) {
    return null;
  }

  if (freshnessError) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="w-full rounded-xl border border-rose-400/40 bg-rose-500/15 p-3 text-rose-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4"
      >
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle className="h-5 w-5 text-rose-300 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-rose-200">
              Could not verify order freshness
            </div>
            <div className="text-xs text-rose-300/90">
              {freshnessError}. The restored order is still displayed.
            </div>
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="px-3 py-1.5 rounded-lg bg-rose-400/20 hover:bg-rose-400/30 text-rose-50 text-xs font-semibold border border-rose-300/30 transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
            {isRetrying ? 'Retrying...' : 'Retry freshness'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="w-full rounded-xl border border-amber-400/40 bg-amber-500/15 p-3 text-amber-100 flex items-start gap-2.5 text-sm mb-4"
    >
      <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
      <div>
        <div className="font-semibold text-amber-200">Order is stale or expired</div>
        <div className="text-xs text-amber-200/90">
          This order has expired on the coordinator or its timelock has passed. Claim and refund actions are disabled.
        </div>
      </div>
    </div>
  );
}

function FreshnessHint({ freshness }: { freshness: FreshnessResult }) {
  if (freshness.label === 'fresh') return null;
  const config = BANNER_CONFIG[freshness.label];
  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${config.classes}`}
      role="status"
      aria-live="polite"
    >
      <span className="mt-px shrink-0 text-base leading-none" aria-hidden="true">
        {config.icon}
      </span>
      <p className="leading-snug">{freshness.hint}</p>
    </div>
  );
}

// ─── Per-label visual config ──────────────────────────────────────────────────

interface BannerConfig {
  icon: string;
  classes: string;
}

const BANNER_CONFIG: Record<Exclude<FreshnessResult['label'], 'fresh'>, BannerConfig> = {
  pending: {
    icon: '⏳',
    classes: 'border-slate-400/20 bg-slate-500/10 text-slate-300',
  },
  stale: {
    icon: '🕐',
    classes: 'border-amber-400/25 bg-amber-500/10 text-amber-200',
  },
  'refund-soon': {
    icon: '⏱',
    classes: 'border-orange-400/30 bg-orange-500/10 text-orange-200',
  },
  'refund-eligible': {
    icon: '↩',
    classes: 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200',
  },
};
