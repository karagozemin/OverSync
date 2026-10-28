import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FreshnessResult } from '../lib/orderFreshness';

/**
 * OrderStaleBanner
 *
 * Two render modes, both non-blocking status hints:
 *
 *   • `freshness` – a precomputed freshness classification (see
 *     `lib/orderFreshness`). Used per transaction row in the history list.
 *     Returns null for fresh/terminal orders.
 *   • `isStale` / `freshnessError` – the bridge form's restored-order state.
 *     Warns that claim/refund are blocked or that freshness could not be
 *     verified (with a retry action).
 *
 * Design principles:
 *   • Calm, informational — never alarming for normal pending states
 *   • No action required from the user unless they can refund
 *   • Visually distinct from the refund buttons (different palette)
 */
export interface OrderStaleBannerProps {
  freshness?: FreshnessResult;
  isStale?: boolean;
  freshnessError?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export default function OrderStaleBanner({
  freshness,
  isStale = false,
  freshnessError = null,
  onRetry,
  isRetrying = false,
}: OrderStaleBannerProps) {
  if (freshness) {
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
    classes:
      'border-slate-400/20 bg-slate-500/10 text-slate-300',
  },
  stale: {
    icon: '🕐',
    classes:
      'border-amber-400/25 bg-amber-500/10 text-amber-200',
  },
  'refund-soon': {
    icon: '⏱',
    classes:
      'border-orange-400/30 bg-orange-500/10 text-orange-200',
  },
  'refund-eligible': {
    icon: '↩',
    classes:
      'border-indigo-400/30 bg-indigo-500/10 text-indigo-200',
  },
};
