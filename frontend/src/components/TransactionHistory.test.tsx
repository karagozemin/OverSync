import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import TransactionHistory from './TransactionHistory';

vi.mock('../config/networks', () => ({
  isTestnet: () => true,
}));

vi.mock('../features/refund/RefundDialog', () => ({
  default: () => null,
}));

const STORAGE_KEY = 'oversync_transactions_v2';

function coordinatorOrder(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'order-recovered',
    direction: 'eth_to_xlm',
    status: 'src_locked',
    hashlock: '0xhashlockrecovered',
    src: {
      chain: 'ethereum',
      address: '0xEthAddress',
      asset: 'ETH',
      amount: '1000000000000000000',
      safetyDeposit: '0',
      orderId: '0xonchainorderid',
      lockTx: '0xrecoveredlocktx',
      lockBlock: 1,
      timelock: 9999999999,
    },
    dst: {
      chain: 'stellar',
      address: 'GSTELLARADDRESS',
      asset: 'XLM',
      amount: '10000000',
      orderId: null,
      lockTx: null,
      lockBlock: null,
      timelock: null,
    },
    secret: { revealed: false, preimage: null, revealedTx: null },
    resolver: '0xResolverContract',
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('TransactionHistory recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('recovers orders from the coordinator after reconnecting a wallet and renders them', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transactions: [coordinatorOrder()] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TransactionHistory ethAddress="0xEthAddress" stellarAddress="GSTELLARADDRESS" />);

    await waitFor(() => {
      expect(screen.getByText('ETH Sepolia')).toBeInTheDocument();
    });

    // One request per connected address, using the coordinator's `address` param.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((u) => u.includes('address=0xEthAddress'))).toBe(true);
    expect(requestedUrls.some((u) => u.includes('address=GSTELLARADDRESS'))).toBe(true);

    // Recovered order persisted to local storage for the next reload.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('order-recovered');
  });

  test('de-duplicates a locally pending order against its coordinator-recovered counterpart', async () => {
    const localTx = {
      id: 'local-temp-id',
      txHash: '0xrecoveredlocktx',
      fromNetwork: 'ETH Sepolia',
      toNetwork: 'Stellar Testnet',
      fromToken: 'ETH',
      toToken: 'XLM',
      amount: '1',
      estimatedAmount: '1',
      status: 'pending',
      timestamp: Date.now(),
      direction: 'eth-to-xlm',
      ethTxHash: '0xrecoveredlocktx',
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([localTx]));

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transactions: [coordinatorOrder({ id: 'coordinator-final-id' })] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TransactionHistory ethAddress="0xEthAddress" stellarAddress="GSTELLARADDRESS" />);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(1);
    });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    // The coordinator's record wins since it carries authoritative on-chain data,
    // but the two entries were recognised as the same order (shared tx hash).
    expect(stored[0].id).toBe('coordinator-final-id');

    // Only a single row rendered for the deduped order, not two.
    expect(screen.getAllByText('ETH Sepolia')).toHaveLength(1);
  });

  test('falls back to the local cache when the coordinator request fails', async () => {
    const localTx = {
      id: 'local-only-order',
      txHash: '0xlocalonlytx',
      fromNetwork: 'ETH Sepolia',
      toNetwork: 'Stellar Testnet',
      fromToken: 'ETH',
      toToken: 'XLM',
      amount: '1',
      estimatedAmount: '1',
      status: 'pending',
      timestamp: Date.now(),
      direction: 'eth-to-xlm',
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([localTx]));

    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TransactionHistory ethAddress="0xEthAddress" />);

    await waitFor(() => {
      expect(screen.getByText('ETH Sepolia')).toBeInTheDocument();
    });

    // Cached local order still renders even though recovery failed.
    expect(screen.getByText(/1 ETH/)).toBeInTheDocument();
  });

  test('does not query the coordinator when no wallet is connected', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<TransactionHistory />);

    await waitFor(() => {
      expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
