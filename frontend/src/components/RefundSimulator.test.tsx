import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RefundSimulator } from './RefundSimulator';

// Stub Date.now() so timelock comparisons are deterministic
const NOW = 1_700_000_000;

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useEffect: (fn: () => void | (() => void)) => { fn(); },
  };
});

describe('RefundSimulator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the simulation header', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/refund state simulator/i)).toBeInTheDocument();
  });

  it('shows read-only simulation disclaimer', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/read-only simulation/i)).toBeInTheDocument();
    expect(screen.getByText(/without submitting any transactions/i)).toBeInTheDocument();
  });

  it('displays eth_to_xlm direction', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/ETH → XLM/)).toBeInTheDocument();
  });

  it('displays xlm_to_eth direction', () => {
    render(
      <RefundSimulator
        direction="xlm_to_eth"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/XLM → ETH/)).toBeInTheDocument();
  });

  // ── Phase: claimable ───────────────────────────────────────────────────

  it('shows claimable state when both timelocks are in the future', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Claimable/)).toBeInTheDocument();
    expect(screen.getByText(/beneficiary can claim/i)).toBeInTheDocument();
  });

  // ── Phase: waiting ─────────────────────────────────────────────────────

  it('shows waiting state when only source timelock has expired', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW - 100}
        dstTimelockUnixSeconds={NOW + 3600}
      />
    );
    expect(screen.getByText(/Waiting/)).toBeInTheDocument();
    expect(screen.getByText(/partial refund available/i)).toBeInTheDocument();
  });

  it('shows waiting state when only destination timelock has expired', () => {
    render(
      <RefundSimulator
        direction="xlm_to_eth"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW - 100}
      />
    );
    expect(screen.getByText(/Waiting/)).toBeInTheDocument();
  });

  // ── Phase: refundable ──────────────────────────────────────────────────

  it('shows refundable state when both timelocks have expired', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW - 200}
        dstTimelockUnixSeconds={NOW - 100}
      />
    );
    expect(screen.getByText(/Refundable/)).toBeInTheDocument();
    expect(screen.getByText(/both legs/i)).toBeInTheDocument();
  });

  // ── Leg cards ──────────────────────────────────────────────────────────

  it('renders source and destination leg cards', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Source/)).toBeInTheDocument();
    expect(screen.getByText(/Destination/)).toBeInTheDocument();
  });

  it('shows chain names in leg cards for eth_to_xlm', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
    expect(screen.getByText(/Stellar/)).toBeInTheDocument();
  });

  it('shows chain names in leg cards for xlm_to_eth', () => {
    render(
      <RefundSimulator
        direction="xlm_to_eth"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Stellar/)).toBeInTheDocument();
    expect(screen.getByText(/Ethereum/)).toBeInTheDocument();
  });

  it('shows claim and refund parties', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Claim before expiry/)).toBeInTheDocument();
    expect(screen.getByText(/Refund after expiry/)).toBeInTheDocument();
  });

  it('renders expandable summary section', () => {
    render(
      <RefundSimulator
        direction="eth_to_xlm"
        srcTimelockUnixSeconds={NOW + 3600}
        dstTimelockUnixSeconds={NOW + 7200}
      />
    );
    expect(screen.getByText(/Full simulation summary/)).toBeInTheDocument();
  });
});
