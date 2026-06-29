import type { FreshnessResult } from '../lib/orderFreshness';

interface Props {
  freshness: FreshnessResult;
}

/**
 * OrderStaleBanner
 *
 * Renders a small, non-blocking status hint beneath a transaction row when an
 * order is taking longer than expected.  Returns null for fresh/terminal orders
 * so callers can render this unconditionally.
 *
 * Design principles:
 *   • Calm, informational — never alarming for normal pending states
 *   • No action required from the user unless they can refund
 *   • Visually distinct from the refund buttons (different palette)
 */
export default function OrderStaleBanner({ freshness }: Props) {
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