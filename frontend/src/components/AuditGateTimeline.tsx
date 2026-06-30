/**
 * AuditGateTimeline
 *
 * Read-only evidence surface for SCF reviewers and investors. Renders the
 * current launch gates (testnet v2, resolver onboarding, fuzz/differential
 * testing, external audit, multisig/governance readiness, mainnet v2
 * enablement) with honest labels and dates.
 *
 * Design constraints (do not relax without product review):
 *  - Status labels are limited to: complete | in progress | planned | blocked.
 *    Honest is more important than optimistic.
 *  - Missing dates render as "TBD" rather than invented calendar points.
 *  - Copy must never imply mainnet v2 is live before audit passes. Even the
 *    mainnet gate stays at "planned" until an audit report is public, per
 *    the project's audit-first commitment in ROADMAP.md.
 *  - No interactive controls: this is an investor/SCF evidence surface, not a
 *    flow surface. Bridge execution / settlement behaviour is intentionally
 *    untouched.
 *
 * Data is sourced manually from ROADMAP.md for now; if it grows, lift into
 * a top-level config module alongside the rest of the SCF evidence.
 */

import { Calendar, Check, Clock, ShieldAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type GateStatus = 'complete' | 'in_progress' | 'planned' | 'blocked';

export interface AuditGate {
  /** Stable identifier for tests + deep links. */
  id: string;
  /** Gate heading. */
  title: string;
  /** Honest status: complete | in_progress | planned | blocked. */
  status: GateStatus;
  /**
   * One-sentence evidence grounded in ROADMAP.md. Must not imply mainnet v2
   * is live before audit.
   */
  evidence: string;
  /**
   * Optional quarter label (e.g. "Q4 2026"). Per ROADMAP.md, dates beyond the
   * current quarter are intentionally ranges, not pinpoint commitments.
   */
  target?: string;
  /**
   * When present, explains why the date is shown as TBD rather than an
   * invented target.
   */
  tbdReason?: string;
  /** Verifiable artefact (e.g. repo folder, dashboard, external URL). */
  artifactLabel?: string;
  artifactHref?: string;
}

export const AUDIT_GATES: readonly AuditGate[] = [
  {
    id: 'testnet-v2-live',
    title: 'Testnet v2 live',
    status: 'complete',
    evidence:
      'Decentralised HTLC stack + open resolver network shipped on Sepolia + Stellar testnet. Phases 0–8 of the v2 rebuild are merged.',
    target: 'Q2 2026',
    artifactLabel: 'ROADMAP.md',
    artifactHref: 'https://github.com/karagozemin/OverSync/blob/main/ROADMAP.md',
  },
  {
    id: 'resolver-onboarding',
    title: 'Resolver onboarding',
    status: 'in_progress',
    evidence:
      'Reference resolver runner + Docker image are public. Community resolver onboarding (≥3 resolvers, 30+ days active) is part of the mainnet launch tranche.',
    tbdReason:
      'Broadcaster call-out for community resolvers begins after external audit is engaged; specific onboarding window not yet committed.',
  },
  {
    id: 'fuzz-differential-testing',
    title: 'Fuzz & differential testing',
    status: 'in_progress',
    evidence:
      'Foundry fuzz + invariant suite for HTLCEscrow, Slither CI gate, and EVM ↔ Soroban differential harness are in active development. Slither is currently advisory; promoting to a failing CI gate is one of the gating steps. The public continuous run that gates release candidates is scheduled within the Q3 audit-prep exit criterion.',
    target: 'Q3 2026',
  },
  {
    id: 'external-audit',
    title: 'External audit',
    status: 'planned',
    evidence:
      'Two independent audits are scheduled: Audit firm A on EVM contracts (HTLCEscrow + ResolverRegistry), Audit firm B on Soroban contracts. Per project policy, no mainnet contract is deployed before its audit report is public. Audit firm names will be disclosed at engagement. Remediation diff and re-audit pass are scoped to the Q4 exit criterion.',
    target: 'Q4 2026',
  },
  {
    id: 'multisig-governance',
    title: 'Multisig / governance readiness',
    status: 'planned',
    evidence:
      'Multisig migration of ResolverRegistry.owner (2-of-3 testnet first, prep for mainnet) is scheduled post-audit. DAO Timelock + Governor is scoped to the v2.1 deepening track and retires the multisig once live.',
    tbdReason:
      'Multisig address is committed to the repo once the original owners are selected; no wallet is published ahead of that.',
  },
  {
    id: 'mainnet-v2-enablement',
    title: 'Mainnet v2 enablement',
    status: 'planned',
    evidence:
      'Mainnet deployment is contingent on a public audit report and a 14-day mainnet TVL > $1k soak with zero incidents. The frontend mainnet toggle (VITE_MAINNET_ENABLED) remains false in the public deployment until that exit criterion closes. Q1 2027 is the publicly stated target range; the exact enablement date depends on audit findings, remediation, and the soak window.',
    target: 'Q1 2027',
  },
];

// ─── Visual config ───────────────────────────────────────────────────────────

interface StatusVisual {
  label: string;
  icon: LucideIcon;
  /** Tailwind utility block applied to the badge. */
  badgeClasses: string;
  /** Tailwind utility block applied to the timeline marker. */
  markerClasses: string;
}

const STATUS_VISUAL: Record<GateStatus, StatusVisual> = {
  complete: {
    label: 'Complete',
    icon: Check,
    badgeClasses:
      'border-emerald-400/35 bg-emerald-500/10 text-emerald-200',
    markerClasses:
      'border-emerald-400/45 bg-emerald-500/15 text-emerald-200 shadow-[0_0_22px_rgba(16,185,129,0.22)]',
  },
  in_progress: {
    label: 'In progress',
    icon: Clock,
    badgeClasses:
      'border-amber-400/35 bg-amber-500/10 text-amber-200',
    markerClasses:
      'border-amber-400/45 bg-amber-500/15 text-amber-200 shadow-[0_0_22px_rgba(245,158,11,0.2)]',
  },
  planned: {
    label: 'Planned',
    icon: Calendar,
    badgeClasses:
      'border-sky-400/35 bg-sky-500/10 text-sky-200',
    markerClasses:
      'border-sky-400/45 bg-sky-500/15 text-sky-200 shadow-[0_0_22px_rgba(56,189,248,0.2)]',
  },
  blocked: {
    label: 'Blocked',
    icon: ShieldAlert,
    badgeClasses:
      'border-rose-400/35 bg-rose-500/10 text-rose-200',
    markerClasses:
      'border-rose-400/45 bg-rose-500/15 text-rose-200 shadow-[0_0_22px_rgba(244,63,94,0.2)]',
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface AuditGateTimelineProps {
  /** Override the gate list. Defaults to the ROADMAP-derived static list. */
  gates?: readonly AuditGate[];
  /** Show the introduction line above the timeline. Defaults to true. */
  showIntro?: boolean;
}

export default function AuditGateTimeline({
  gates = AUDIT_GATES,
  showIntro = true,
}: AuditGateTimelineProps) {
  return (
    <section
      className="surface-panel rounded-2xl p-6 md:p-8"
      aria-labelledby="audit-gate-timeline-heading"
      data-testid="audit-gate-timeline"
    >
      {showIntro && (
        <header className="mb-6 md:mb-8">
          <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/70">
            Launch readiness
          </p>
          <h2
            id="audit-gate-timeline-heading"
            className="mt-2 text-2xl font-semibold text-white md:text-3xl"
          >
            Audit-gate timeline
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300/90 md:text-base">
            Read-only view of the gates between the current testnet build and a
            public mainnet v2 launch. Status reflects ROADMAP.md as it stands
            today; missing dates are shown as TBD rather than invented.
          </p>
        </header>
      )}

      <ol
        className="relative space-y-5 border-l border-white/10 pl-6 md:space-y-7 md:pl-8"
        aria-label="Launch gates in order"
      >
        {gates.map((gate) => {
          const visual = STATUS_VISUAL[gate.status];
          const StatusIcon = visual.icon;
          const isTbd = !gate.target;
          return (
            <li
              key={gate.id}
              className="relative"
              data-testid={`audit-gate-${gate.id}`}
              data-status={gate.status}
            >
              <span
                aria-hidden="true"
                className={`absolute -left-[37px] top-1.5 flex h-7 w-7 items-center justify-center rounded-full border md:-left-[45px] ${visual.markerClasses}`}
              >
                <StatusIcon className="h-4 w-4" />
              </span>

              <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.035] p-4 md:flex-row md:items-start md:justify-between md:gap-6 md:p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-white md:text-lg">
                      {gate.title}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] ${visual.badgeClasses}`}
                      data-testid={`audit-gate-status-${gate.id}`}
                    >
                      {visual.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300/90">
                    {gate.evidence}
                  </p>
                  {gate.tbdReason && (
                    <p className="mt-2 text-xs leading-5 text-slate-400/85">
                      {gate.tbdReason}
                    </p>
                  )}
                  {gate.artifactLabel && gate.artifactHref && (
                    <p className="mt-2 text-xs">
                      <a
                        className="text-cyan-200 underline-offset-2 transition hover:text-cyan-100 hover:underline"
                        href={gate.artifactHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {gate.artifactLabel}
                      </a>
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-start gap-1 md:items-end md:text-right">
                  <span className="text-[10px] uppercase tracking-[0.22em] text-slate-400/80">
                    Target
                  </span>
                  <span
                    className={`text-sm font-semibold ${isTbd ? 'text-slate-300/70' : 'text-white'}`}
                    data-testid={`audit-gate-target-${gate.id}`}
                  >
                    {isTbd ? 'TBD' : gate.target}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
