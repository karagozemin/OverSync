import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditGateTimeline, {
  AUDIT_GATES,
  type AuditGate,
  type GateStatus,
} from './AuditGateTimeline';

const SAMPLE_GATES: AuditGate[] = [
  {
    id: 'sample-complete',
    title: 'Sample complete gate',
    status: 'complete',
    evidence: 'Evidence text.',
    target: 'Q2 2026',
  },
  {
    id: 'sample-in-progress',
    title: 'Sample in progress gate',
    status: 'in_progress',
    evidence: 'Evidence text.',
    tbdReason: 'No concrete date committed yet.',
  },
  {
    id: 'sample-planned',
    title: 'Sample planned gate',
    status: 'planned',
    evidence: 'Evidence text.',
    target: 'Q4 2026',
  },
  {
    id: 'sample-blocked',
    title: 'Sample blocked gate',
    status: 'blocked',
    evidence: 'Evidence text.',
    tbdReason: 'Awaiting prior milestone.',
  },
];

describe('AuditGateTimeline', () => {
  test('renders the timeline heading and intro copy', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { level: 2, name: /Audit-gate timeline/i })).toBeInTheDocument();
    // Intro copy must commit to "TBD rather than invented" so the honesty
    // contract is visible in the rendered text, not only in the source.
    expect(screen.getByText(/TBD rather than invented/i)).toBeInTheDocument();
  });

  test('renders exactly one list of gates', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    const list = screen.getByRole('list', { name: /launch gates in order/i });
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll('li')).toHaveLength(SAMPLE_GATES.length);
  });

  test('renders each gate with its own status badge label', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('audit-gate-status-sample-complete')).toHaveTextContent('Complete');
    expect(screen.getByTestId('audit-gate-status-sample-in-progress')).toHaveTextContent('In progress');
    expect(screen.getByTestId('audit-gate-status-sample-planned')).toHaveTextContent('Planned');
    expect(screen.getByTestId('audit-gate-status-sample-blocked')).toHaveTextContent('Blocked');
  });

  test('shows target quarter when defined, TBD when missing', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    expect(screen.getByTestId('audit-gate-target-sample-complete')).toHaveTextContent('Q2 2026');
    expect(screen.getByTestId('audit-gate-target-sample-in-progress')).toHaveTextContent('TBD');
    expect(screen.getByTestId('audit-gate-target-sample-planned')).toHaveTextContent('Q4 2026');
    expect(screen.getByTestId('audit-gate-target-sample-blocked')).toHaveTextContent('TBD');
  });

  test('renders the TBD reason text for gates without a concrete target', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    expect(screen.getByText(/No concrete date committed yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Awaiting prior milestone/i)).toBeInTheDocument();
  });

  test('hides the intro block when showIntro=false', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} showIntro={false} />
      </MemoryRouter>
    );

    expect(screen.queryByRole('heading', { level: 2, name: /Audit-gate timeline/i })).not.toBeInTheDocument();
    // list itself still renders
    expect(screen.getByRole('list', { name: /launch gates in order/i })).toBeInTheDocument();
  });

  test('all data-status attributes are limited to the allowed set', () => {
    render(
      <MemoryRouter>
        <AuditGateTimeline gates={SAMPLE_GATES} />
      </MemoryRouter>
    );

    const allowed: GateStatus[] = ['complete', 'in_progress', 'planned', 'blocked'];
    const items = screen.getAllByRole('listitem');
    for (const li of items) {
      const status = li.getAttribute('data-status');
      expect(status).not.toBeNull();
      expect(allowed).toContain(status as GateStatus);
    }
  });
});

describe('AUDIT_GATES (ROADMAP-derived static data)', () => {
  test('contains exactly the six required launch gates in order', () => {
    expect(AUDIT_GATES.map((g) => g.id)).toEqual([
      'testnet-v2-live',
      'resolver-onboarding',
      'fuzz-differential-testing',
      'external-audit',
      'multisig-governance',
      'mainnet-v2-enablement',
    ]);
  });
  test('only allows the four honest status values', () => {
    const allowed: GateStatus[] = ['complete', 'in_progress', 'planned', 'blocked'];
    for (const gate of AUDIT_GATES) {
      expect(allowed).toContain(gate.status);
    }
  });

  test('testnet-v2-live is complete and mainnet-v2 enablement is not complete', () => {
    const testnet = AUDIT_GATES.find((g) => g.id === 'testnet-v2-live');
    const mainnet = AUDIT_GATES.find((g) => g.id === 'mainnet-v2-enablement');

    expect(testnet?.status).toBe('complete');
    expect(mainnet?.status).not.toBe('complete');
    expect(['planned', 'blocked']).toContain(mainnet?.status as GateStatus);
  });

  test('data shape is clean: gates have target XOR tbdReason, never both, never neither', () => {
    for (const gate of AUDIT_GATES) {
      const hasTarget = typeof gate.target === 'string' && gate.target.length > 0;
      const hasTbd = typeof gate.tbdReason === 'string' && gate.tbdReason.length > 0;
      // XOR: a gate has either a concrete target or a TBD reason — never both.
      expect(hasTarget !== hasTbd).toBe(true);
    }
  });

  test('forbidden phrases are absent from every gate', () => {
    // Forbidden phrases that would mislead investors / SCF reviewers.
    // Per ROADMAP.md, audit-first means mainnet must NOT be live before the
    // audit report is public.
    const forbidden: RegExp[] = [
      /mainnet (is )?live/i,
      /mainnet enabled/i,
      /mainnet launched/i,
      /launched on mainnet/i,
      /audit (is )?(complete|done|passed|shipped)/i,
      /ready for production/i,
      /shipping soon/i,
      /public release/i,
    ];

    for (const gate of AUDIT_GATES) {
      const text = `${gate.evidence} ${gate.tbdReason ?? ''}`;
      for (const re of forbidden) {
        expect(text, `gate "${gate.id}" contained forbidden phrase`).not.toMatch(re);
      }
    }
  });

  test('mainnet gate copy uses the required honest language', () => {
    const mainnet = AUDIT_GATES.find((g) => g.id === 'mainnet-v2-enablement');
    expect(mainnet).toBeDefined();
    // The badge label (status visual) is the canonical "this is not live yet"
    // marker; the copy must not contradict it.
    expect(mainnet?.status).toBe('planned');
    const text = `${mainnet!.evidence} ${mainnet!.tbdReason ?? ''}`.toLowerCase();
    expect(text).toMatch(/audit/);
    expect(text).toMatch(/contingent/);
    expect(text).toMatch(/(remains|until)/);
  });

  test('external audit gate stays at planned with no fabricated completion', () => {
    const audit = AUDIT_GATES.find((g) => g.id === 'external-audit');
    expect(audit?.status).toBe('planned');
  });

  test('multisig-governance gate stays at planned with no fabricated completion', () => {
    const ms = AUDIT_GATES.find((g) => g.id === 'multisig-governance');
    expect(ms?.status).toBe('planned');
  });
});
