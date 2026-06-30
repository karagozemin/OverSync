/**
 * LaunchReadinessSurface
 *
 * Read-only investor / SCF surface. Renders the audit-gate timeline with a
 * sober envelope (header, footnote, back-link) so reviewers see it as a
 * permanent evidence artefact rather than part of the swap UI.
 *
 * No interactive controls: nothing here can trigger a bridge or settlement
 * action, by design.
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import AuditGateTimeline from '../components/AuditGateTimeline';

export default function LaunchReadinessSurface() {
  return (
    <div className="app-shell min-h-screen text-white">
      <header className="border-b border-cyan-200/15 bg-[#050817]/78 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between md:px-8 md:py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200/25 bg-cyan-200/10 text-cyan-100">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/70">
                OverSync v2
              </p>
              <h1 className="text-xl font-semibold text-white md:text-2xl">
                Launch readiness
              </h1>
            </div>
          </div>
          <Link
            to="/"
            className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-200/35 hover:bg-cyan-200/10 hover:text-white md:self-auto"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to bridge
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
        <p className="mb-6 text-sm leading-6 text-slate-300/90 md:text-base">
          This page tracks the gates between the current testnet build and a
          public mainnet v2 launch. Status, evidence and target dates are
          drawn from <span className="text-white">ROADMAP.md</span>; no claim
          on this page should be read as mainnet being live or imminent.
        </p>

        <AuditGateTimeline />

        <footer className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-slate-300/90">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <p className="font-semibold text-white">Project policy: audit-first.</p>
              <p className="mt-1 text-slate-300/90">
                No mainnet contract is deployed before its audit report is
                public. The frontend mainnet toggle remains{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[12px] text-slate-100">
                  VITE_MAINNET_ENABLED=false
                </code>{' '}
                in the public deployment until that policy closes.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
