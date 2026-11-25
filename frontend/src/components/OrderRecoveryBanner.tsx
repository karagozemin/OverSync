import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { RecoveredOrder } from '../lib/orderRecovery';

export interface OrderRecoveryBannerProps {
  order?: RecoveredOrder | null;
  isStale?: boolean;
  freshnessError?: string | null;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export default function OrderRecoveryBanner({
  order: _order,
  isStale = false,
  freshnessError = null,
  onRetry,
  isRetrying = false,
}: OrderRecoveryBannerProps) {
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
