import { useState, useMemo, useEffect } from "react";
import { Shield, Clock, Info, AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { simulateRefundTimeline, type SimulatedState } from "@oversync/sdk";

type SimDirection = "eth-to-xlm" | "xlm-to-eth";

interface Example {
  label: string;
  direction: SimDirection;
  sourceTimelock: number;
  destinationTimelock: number;
  sourceLocked: boolean;
  destinationLocked: boolean;
  state: SimulatedState;
}

const NOW = Math.floor(Date.now() / 1000);

const EXAMPLES: Example[] = [
  {
    label: "ETH → XLM — Waiting",
    direction: "eth-to-xlm",
    sourceTimelock: NOW + 7200,
    destinationTimelock: NOW + 3600,
    sourceLocked: true,
    destinationLocked: false,
    state: "waiting",
  },
  {
    label: "ETH → XLM — Claimable",
    direction: "eth-to-xlm",
    sourceTimelock: NOW + 7200,
    destinationTimelock: NOW + 3600,
    sourceLocked: true,
    destinationLocked: true,
    state: "claimable",
  },
  {
    label: "ETH → XLM — Refundable",
    direction: "eth-to-xlm",
    sourceTimelock: NOW - 1,
    destinationTimelock: NOW - 1,
    sourceLocked: true,
    destinationLocked: true,
    state: "refundable",
  },
  {
    label: "XLM → ETH — Waiting",
    direction: "xlm-to-eth",
    sourceTimelock: NOW + 7200,
    destinationTimelock: NOW + 3600,
    sourceLocked: true,
    destinationLocked: false,
    state: "waiting",
  },
  {
    label: "XLM → ETH — Claimable",
    direction: "xlm-to-eth",
    sourceTimelock: NOW + 7200,
    destinationTimelock: NOW + 3600,
    sourceLocked: true,
    destinationLocked: true,
    state: "claimable",
  },
  {
    label: "XLM → ETH — Refundable",
    direction: "xlm-to-eth",
    sourceTimelock: NOW - 1,
    destinationTimelock: NOW - 1,
    sourceLocked: true,
    destinationLocked: true,
    state: "refundable",
  },
];

function toSDKDirection(d: SimDirection): "eth_to_xlm" | "xlm_to_eth" {
  return d === "eth-to-xlm" ? "eth_to_xlm" : "xlm_to_eth";
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

const STATE_STYLES: Record<SimulatedState, { bg: string; border: string; text: string; icon: typeof Clock }> = {
  waiting: { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-300", icon: Clock },
  claimable: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-300", icon: CheckCircle },
  refundable: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-300", icon: AlertTriangle },
};

export function RefundTimelineSimulator() {
  const [selectedExample, setSelectedExample] = useState<number>(1);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const ex = EXAMPLES[selectedExample];

  const result = useMemo(
    () =>
      simulateRefundTimeline({
        direction: toSDKDirection(ex.direction),
        sourceTimelockUnixSeconds: ex.sourceTimelock,
        destinationTimelockUnixSeconds: ex.destinationTimelock,
        sourceLockObserved: ex.sourceLocked,
        destinationLockObserved: ex.destinationLocked,
        nowUnixSeconds: now,
      }),
    [ex, now],
  );

  const srcChain = ex.direction === "eth-to-xlm" ? "Ethereum" : "Stellar";
  const dstChain = ex.direction === "eth-to-xlm" ? "Stellar" : "Ethereum";
  const srcAsset = ex.direction === "eth-to-xlm" ? "ETH" : "XLM";
  const dstAsset = ex.direction === "eth-to-xlm" ? "XLM" : "ETH";

  const StateIcon = STATE_STYLES[result.state].icon;

  const timelockStatus = (timelock: number, label: string, label2: string) => {
    const expired = now >= timelock;
    const remaining = timelock - now;
    return (
      <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
        <div>
          <span className="text-xs text-slate-400">{label}</span>
          <p className="text-sm text-white font-mono">{formatDate(timelock)}</p>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400">{label2}</span>
          <p className={`text-sm font-mono ${expired ? "text-red-400" : "text-emerald-400"}`}>
            {expired ? "Expired" : `${Math.ceil(remaining / 60)} min remaining`}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 font-sans text-sm glass-effect">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
        <Shield className="h-4 w-4 text-cyan-400" />
        <h4 className="font-semibold text-white">Refund Timeline Simulator</h4>
        <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-2xs font-medium text-amber-400">
          Read-only simulation
        </span>
      </div>

      {/* Read-only disclaimer */}
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2">
        <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-300/80">
          This is a read-only simulator that explains refund timing. It does not submit any transactions
          and does not interact with any blockchain.
        </p>
      </div>

      {/* Example selector */}
      <div className="mb-4">
        <p className="text-xs text-slate-400 mb-2">Select an example scenario:</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => setSelectedExample(i)}
              className={`rounded-lg px-2 py-1.5 text-xs font-medium text-left transition border ${
                i === selectedExample
                  ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
              }`}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Direction badge */}
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
          {srcChain}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
          {dstChain}
        </span>
      </div>

      {/* Timelocks */}
      <div className="mb-4 space-y-2">
        {timelockStatus(ex.sourceTimelock, `${srcChain} timelock expiry`, `${srcAsset} refund available`)}
        {timelockStatus(ex.destinationTimelock, `${dstChain} timelock expiry`, `${dstAsset} claim available`)}
      </div>

      {/* State */}
      <div className={`mb-4 rounded-lg border ${STATE_STYLES[result.state].border} ${STATE_STYLES[result.state].bg} p-3 flex items-start gap-2`}>
        <StateIcon className={`h-5 w-5 ${STATE_STYLES[result.state].text} mt-0.5 shrink-0`} />
        <div>
          <p className={`text-sm font-medium ${STATE_STYLES[result.state].text}`}>
            {result.stateLabel}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{result.stateDescription}</p>
        </div>
      </div>

      {/* Claim and refund info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2">
          <p className="text-xs font-medium text-emerald-400 mb-1">Claimable by</p>
          <p className="text-xs text-slate-300">{result.claimableBy}</p>
        </div>
        <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 px-3 py-2">
          <p className="text-xs font-medium text-cyan-400 mb-1">Refundable by</p>
          <p className="text-xs text-slate-300">{result.refundableBy}</p>
        </div>
      </div>
    </div>
  );
}
