import { useMemo, useState, useEffect } from "react";
import { Clock, ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { simulateRefund } from "@oversync/sdk";
import type { Direction, SimulatedPhase, LegSimulation } from "@oversync/sdk";

export interface RefundSimulatorProps {
  direction: Direction;
  srcTimelockUnixSeconds: number;
  dstTimelockUnixSeconds: number;
}

function LegCard({ leg, label }: { leg: LegSimulation; label: string }) {
  return (
    <div className="rounded-lg border border-cyan-200/20 bg-[#0d1225]/80 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {label} — {leg.chain}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            leg.expired
              ? "bg-red-500/15 text-red-300"
              : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {leg.expired ? "expired" : "active"}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">Timelock</span>
          <span className="text-white font-mono">
            {new Date(leg.timelockUnix * 1000).toISOString()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Claim before expiry</span>
          <span className="text-white">{leg.claimParty}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Refund after expiry</span>
          <span className="text-white">{leg.refundParty}</span>
        </div>
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: SimulatedPhase }) {
  if (phase === "refundable") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
        <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
        <div className="text-sm">
          <p className="text-red-300 font-medium">Refundable</p>
          <p className="text-gray-400 text-xs">
            Both timelocks have expired. Refund is available on both legs.
          </p>
        </div>
      </div>
    );
  }
  if (phase === "waiting") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
        <Clock className="h-5 w-5 text-amber-400 shrink-0" />
        <div className="text-sm">
          <p className="text-amber-300 font-medium">Waiting</p>
          <p className="text-gray-400 text-xs">
            One timelock has expired while the other is still active. Partial refund available.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3">
      <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
      <div className="text-sm">
        <p className="text-emerald-300 font-medium">Claimable</p>
        <p className="text-gray-400 text-xs">
          Both timelocks are active. The beneficiary can claim on either chain.
        </p>
      </div>
    </div>
  );
}

export function RefundSimulator({
  direction,
  srcTimelockUnixSeconds,
  dstTimelockUnixSeconds,
}: RefundSimulatorProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const sim = useMemo(
    () =>
      simulateRefund({
        direction,
        srcTimelockUnixSeconds,
        dstTimelockUnixSeconds,
        nowUnixSeconds: now,
      }),
    [direction, srcTimelockUnixSeconds, dstTimelockUnixSeconds, now]
  );

  return (
    <div className="max-w-lg rounded-2xl border border-cyan-200/20 bg-[#070b1c]/95 p-5 shadow-2xl shadow-black/55 backdrop-blur-2xl w-full space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Info className="h-4 w-4 text-cyan-400" />
        <h2 className="text-base font-bold text-white">Refund state simulator</h2>
      </div>

      <p className="text-xs text-gray-500 italic leading-relaxed border-l-2 border-cyan-400/30 pl-3">
        This is a read-only simulation. It explains the refund state of the cross-chain
        swap without submitting any transactions. All information is for educational
        purposes only.
      </p>

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Direction</span>
        <span className="rounded-full bg-cyan-500/15 px-3 py-0.5 text-sm font-semibold text-cyan-300">
          {direction === "eth_to_xlm" ? "ETH → XLM" : "XLM → ETH"}
        </span>
      </div>

      <PhaseBadge phase={sim.phase} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <LegCard leg={sim.src} label="Source" />
        <LegCard leg={sim.dst} label="Destination" />
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300 transition-colors select-none">
          Full simulation summary
        </summary>
        <p className="mt-2 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
          {sim.summary}
        </p>
      </details>
    </div>
  );
}

export default RefundSimulator;
