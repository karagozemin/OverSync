/**
 * Timeline claim-gating tests (issue #274).
 *
 * Uses the shared receipt fixtures and does NOT connect a wallet — the
 * component under test only renders from plain transaction data.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import HtlcTimeline, { verifyClaimForTimeline } from './HtlcTimeline';
import type { HtlcTimelineProps } from './HtlcTimeline';
import {
  v2OrderClaimedLog,
  receiptFromLogs,
  ORDER_HASHLOCK,
  ORDER_PREIMAGE,
  OTHER_HASHLOCK,
  V2_ORDER_ID,
  V2_OTHER_ORDER_ID,
  LOCK_AMOUNT_WEI,
  OTHER_AMOUNT_WEI,
  NATIVE_ETH,
} from '../lib/htlc-receipt-fixtures';
import { parseHtlcClaim } from '../lib/parseHtlcReceipt';

vi.mock('../config/networks', () => ({
  isTestnet: () => true,
}));

function baseTx(overrides: Partial<HtlcTimelineProps['tx']> = {}): HtlcTimelineProps['tx'] {
  return {
    id: 'tx-1',
    txHash: '0xaaaa111111111111111111111111111111111111111111111111111111111111',
    fromNetwork: 'ETH Sepolia',
    toNetwork: 'Stellar Testnet',
    fromToken: 'ETH',
    toToken: 'XLM',
    amount: '1',
    estimatedAmount: '1',
    status: 'completed',
    timestamp: Date.now(),
    direction: 'eth-to-xlm',
    ethTxHash: '0xaaaa111111111111111111111111111111111111111111111111111111111111',
    stellarTxHash: '0xbbbb222222222222222222222222222222222222222222222222222222222222',
    ...overrides,
  };
}

function matchingOrder(overrides: Partial<NonNullable<HtlcTimelineProps['order']>> = {}) {
  return {
    orderId: V2_ORDER_ID,
    hashlock: ORDER_HASHLOCK,
    amountWei: LOCK_AMOUNT_WEI,
    token: NATIVE_ETH,
    ...overrides,
  };
}

/** Decode the shared claim log into a claimReceipt for the tx. */
function claimReceiptFrom(log = v2OrderClaimedLog()) {
  const claim = parseHtlcClaim([log]);
  if (!claim) throw new Error('fixture claim log failed to parse');
  return {
    orderId: claim.orderId,
    hashlock: ORDER_HASHLOCK,
    amountWei: LOCK_AMOUNT_WEI,
    token: NATIVE_ETH,
    preimage: claim.preimage,
  };
}

describe('verifyClaimForTimeline (issue #274)', () => {
  test('verifies a claim whose receipt matches hashlock, amount, asset, and order id', () => {
    const tx = baseTx({ claimReceipt: claimReceiptFrom() });
    const result = verifyClaimForTimeline(tx, matchingOrder());
    expect(result.claimed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  test('withholds a claim whose order id belongs to a different swap', () => {
    const tx = baseTx({ claimReceipt: claimReceiptFrom() });
    const result = verifyClaimForTimeline(tx, matchingOrder({ orderId: V2_OTHER_ORDER_ID }));
    expect(result.claimed).toBe(false);
    expect(result.mismatches).toContain('orderId');
  });

  test('withholds a claim whose hashlock differs from the order', () => {
    const tx = baseTx({
      claimReceipt: { ...claimReceiptFrom(), hashlock: OTHER_HASHLOCK },
    });
    const result = verifyClaimForTimeline(tx, matchingOrder());
    expect(result.claimed).toBe(false);
    expect(result.mismatches).toContain('hashlock');
  });

  test('withholds a claim whose amount differs from the order', () => {
    const tx = baseTx({
      claimReceipt: { ...claimReceiptFrom(), amountWei: OTHER_AMOUNT_WEI },
    });
    const result = verifyClaimForTimeline(tx, matchingOrder());
    expect(result.claimed).toBe(false);
    expect(result.mismatches).toContain('amount');
  });

  test('withholds a claim for a different asset', () => {
    const tx = baseTx({
      claimReceipt: {
        ...claimReceiptFrom(),
        token: '0x0000000000000000000000000000000000000001',
      },
    });
    const result = verifyClaimForTimeline(tx, matchingOrder());
    expect(result.claimed).toBe(false);
    expect(result.mismatches).toContain('asset');
  });

  test('rejects a preimage that does not hash to the order hashlock', () => {
    const tx = baseTx({
      claimReceipt: { ...claimReceiptFrom(), preimage: OTHER_HASHLOCK },
    });
    const result = verifyClaimForTimeline(tx, matchingOrder());
    expect(result.claimed).toBe(false);
    expect(result.mismatches).toContain('hashlock');
  });

  test('never claims without coordinator order data to verify against', () => {
    const tx = baseTx({ claimReceipt: claimReceiptFrom() });
    expect(verifyClaimForTimeline(tx, null).claimed).toBe(false);
    expect(verifyClaimForTimeline(tx, {}).claimed).toBe(false);
  });

  test('does not claim when no claim receipt exists', () => {
    const tx = baseTx();
    expect(verifyClaimForTimeline(tx, matchingOrder()).claimed).toBe(false);
  });
});

describe('HtlcTimeline component', () => {
  test('renders the Claimed step as completed for a verified claim', () => {
    const tx = baseTx({ claimReceipt: claimReceiptFrom() });
    render(<HtlcTimeline tx={tx} order={matchingOrder()} />);

    const step = screen.getByTestId('htlc-step-claimed');
    expect(step).toHaveAttribute('data-step-status', 'completed');
  });

  test('renders Claimed as unverified when the receipt is for another swap', () => {
    const tx = baseTx({ claimReceipt: claimReceiptFrom() });
    render(<HtlcTimeline tx={tx} order={matchingOrder({ orderId: V2_OTHER_ORDER_ID })} />);

    const step = screen.getByTestId('htlc-step-claimed');
    expect(step).toHaveAttribute('data-step-status', 'unverified');
    expect(screen.getByText(/order id does not match this order/)).toBeInTheDocument();
  });

  test('renders Claimed as unverified when a truncated receipt cannot be verified', () => {
    const tx = baseTx({
      status: 'completed',
      claimReceipt: { orderId: null, hashlock: null, amountWei: null, token: null },
    });
    render(<HtlcTimeline tx={tx} order={matchingOrder()} />);

    const step = screen.getByTestId('htlc-step-claimed');
    expect(step).toHaveAttribute('data-step-status', 'unverified');
    expect(screen.getByText(/does not match this order/)).toBeInTheDocument();
  });

  test('keeps Claimed pending while the swap is in flight without a claim receipt', () => {
    const tx = baseTx({ status: 'pending' });
    render(<HtlcTimeline tx={tx} order={matchingOrder()} />);

    const step = screen.getByTestId('htlc-step-claimed');
    expect(step).toHaveAttribute('data-step-status', 'pending');
  });

  test('does not mark the swap completed from a coordinator status alone', () => {
    // Coordinator says completed, but the only claim receipt we have
    // belongs to a different order — the timeline must not advance.
    const tx = baseTx({ status: 'completed', claimReceipt: claimReceiptFrom() });
    render(<HtlcTimeline tx={tx} order={matchingOrder({ orderId: V2_OTHER_ORDER_ID })} />);

    expect(screen.getByTestId('htlc-step-claimed')).toHaveAttribute('data-step-status', 'unverified');
    // The Claimable step stays in the settled path's "active" state while
    // the claim is unverified — the swap is not silently "completed".
    expect(screen.getByTestId('htlc-step-claimable')).toHaveAttribute('data-step-status', 'active');
    expect(screen.getByTestId('htlc-step-claimed')).not.toHaveAttribute('data-step-status', 'completed');
  });

  test('renders the receipt logs fixture end-to-end through the real parser', () => {
    // Prove the shared fixture path: logs -> parseHtlcClaim -> verify.
    const logs = receiptFromLogs([v2OrderClaimedLog()]);
    const claim = parseHtlcClaim(logs.logs as never);
    expect(claim).not.toBeNull();
    expect(claim!.preimage).toBe(ORDER_PREIMAGE);
  });
});
