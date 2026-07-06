import { ExternalLink, FileText, ShieldCheck, Clock, ArrowRight } from 'lucide-react';
import type { HtlcReceiptData } from '../lib/parseHtlcReceipt';
import CopyableIdentifier from './CopyableIdentifier';

interface Props {
  receipt: HtlcReceiptData;
}

function ExplorerLink({ url, label, hash }: { url: string; label: string; hash: string }) {
  if (!hash) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
    >
      <span>{label}</span>
      <ExternalLink className="h-3 w-3 opacity-70" />
    </a>
  );
}

const STATUS_CONFIG = {
  completed: { label: 'Completed', classes: 'text-green-400 bg-green-500/20' },
  refunded: { label: 'Refunded', classes: 'text-emerald-400 bg-emerald-500/20' },
  failed: { label: 'Failed', classes: 'text-red-400 bg-red-500/20' },
} as const;

export default function HtlcReceiptCard({ receipt }: Props) {
  const statusCfg = STATUS_CONFIG[receipt.finalState];

  return (
    <div className="mt-3 rounded-xl border border-cyan-200/15 bg-cyan-500/[0.04] p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-cyan-300" />
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300/80">
            HTLC Settlement Receipt
          </span>
        </div>
        <div className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusCfg.classes}`}>
          {statusCfg.label}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-center gap-2 text-xs">
        <span className="font-medium text-white">{receipt.sourceChain}</span>
        <ArrowRight className="h-3 w-3 text-slate-500" />
        <span className="font-medium text-white">{receipt.destinationChain}</span>
      </div>

      <div className="mb-3 grid grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Order ID</p>
          <CopyableIdentifier
            value={receipt.orderId}
            truncate
            truncateHead={10}
            truncateTail={8}
            copyLabel="order id"
            textClassName="text-[11px] text-slate-300"
          />
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500">Amount</p>
          <p className="font-mono text-[11px] text-white">
            {receipt.amount} {receipt.fromToken}
            <span className="text-slate-500"> → </span>
            {receipt.estimatedAmount} {receipt.toToken}
          </p>
        </div>
      </div>

      <div className="mb-3 space-y-1.5">
        <div className="flex items-center justify-between rounded-md bg-black/20 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            Lock
          </span>
          <ExplorerLink url={receipt.lockTx.url} label={receipt.lockTx.label} hash={receipt.lockTx.hash} />
        </div>
        {receipt.claimTx && (
          <div className="flex items-center justify-between rounded-md bg-black/20 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              Claim
            </span>
            <ExplorerLink url={receipt.claimTx.url} label={receipt.claimTx.label} hash={receipt.claimTx.hash} />
          </div>
        )}
        {receipt.refundTx && (
          <div className="flex items-center justify-between rounded-md bg-black/20 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              Refund
            </span>
            <ExplorerLink url={receipt.refundTx.url} label={receipt.refundTx.label} hash={receipt.refundTx.hash} />
          </div>
        )}
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-md bg-black/20 px-3 py-2">
        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <p className="text-[11px] leading-snug text-slate-400">{receipt.timelockSummary}</p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-cyan-400/15 bg-cyan-400/[0.06] px-3 py-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" />
        <p className="text-[11px] leading-snug text-cyan-200/90">{receipt.nonCustodialExplanation}</p>
      </div>
    </div>
  );
}
