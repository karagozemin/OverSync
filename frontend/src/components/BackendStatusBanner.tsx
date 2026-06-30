import { RefreshCw } from 'lucide-react';
import type { BackendStatusState } from '../lib/useBackendStatus';

interface Props {
  statusState: BackendStatusState;
}

const STATUS_CONFIG = {
  checking: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Checking coordinator…',
    strip: 'border-white/5 bg-white/[0.03] text-slate-400',
  },
  reachable: {
    dot: 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.55)]',
    label: 'Coordinator reachable',
    strip: 'border-white/5 bg-white/[0.03] text-slate-400',
  },
  unavailable: {
    dot: 'bg-red-400',
    label: 'Coordinator unavailable',
    strip: 'border-red-400/30 bg-red-500/10 text-red-200',
  },
  degraded: {
    dot: 'bg-amber-400',
    label: 'Coordinator degraded',
    strip: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
  },
} as const;

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function BackendStatusBanner({ statusState }: Props) {
  const { status, lastChecked, errorMessage, retry } = statusState;
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Backend coordinator status"
      className={`w-full border-b px-6 py-2 flex items-center gap-3 text-xs ${cfg.strip}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} aria-hidden="true" />
      <span className="font-medium">{cfg.label}</span>

      {errorMessage && status !== 'reachable' && (
        <span className="opacity-70">— {errorMessage}</span>
      )}

      {lastChecked && (
        <span className="ml-auto tabular-nums opacity-60">
          Last checked {formatTime(lastChecked)}
        </span>
      )}

      <button
        type="button"
        onClick={retry}
        disabled={status === 'checking'}
        aria-label="Retry backend connection check"
        title="Retry"
        className="ml-2 inline-flex items-center gap-1 rounded px-2 py-1 opacity-70 transition-opacity hover:opacity-100 disabled:cursor-not-allowed"
      >
        <RefreshCw className={`h-3 w-3 ${status === 'checking' ? 'animate-spin' : ''}`} />
        Retry
      </button>
    </div>
  );
}
