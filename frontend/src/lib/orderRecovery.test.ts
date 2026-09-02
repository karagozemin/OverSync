import { describe, expect, test } from 'vitest';
import {
  fetchCoordinatorOrders,
  isRealHash,
  isRealTransaction,
  mapCoordinatorOrderToTransaction,
  mergeTransactions,
  type Transaction,
} from './orderRecovery';

function makeCoordinatorOrder(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'order-123',
    direction: 'eth_to_xlm',
    status: 'src_locked',
    hashlock: '0xhashlock123',
    src: {
      chain: 'ethereum',
      address: '0xEthAddress',
      asset: 'ETH',
      amount: '1000000000000000000',
      safetyDeposit: '0',
      orderId: '0xonchainorderid',
      lockTx: '0xethlocktx',
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
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    ...overrides,
  };
}

function makeLocalTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'order-123',
    txHash: '0xethlocktx',
    fromNetwork: 'ETH Sepolia',
    toNetwork: 'Stellar Testnet',
    fromToken: 'ETH',
    toToken: 'XLM',
    amount: '1',
    estimatedAmount: '1',
    status: 'pending',
    timestamp: 1_700_000_000_000,
    direction: 'eth-to-xlm',
    ...overrides,
  };
}

describe('mapCoordinatorOrderToTransaction', () => {
  test('maps a raw coordinator order into the UI Transaction shape', () => {
    const tx = mapCoordinatorOrderToTransaction(makeCoordinatorOrder());

    expect(tx.id).toBe('order-123');
    expect(tx.direction).toBe('eth-to-xlm');
    expect(tx.status).toBe('pending');
    expect(tx.hashlock).toBe('0xhashlock123');
    expect(tx.onChainOrderId).toBe('0xonchainorderid');
    expect(tx.ethTxHash).toBe('0xethlocktx');
    expect(tx.timelockUnixSeconds).toBe(9999999999);
  });

  test('passes through already-mapped local transactions unchanged', () => {
    const local = makeLocalTransaction();
    expect(mapCoordinatorOrderToTransaction(local)).toBe(local);
  });

  test('maps refunded orders to cancelled status with refund metadata', () => {
    const tx = mapCoordinatorOrderToTransaction(
      makeCoordinatorOrder({
        status: 'refunded',
        secret: { revealed: false, preimage: null, revealedTx: '0xrefundtx' },
      })
    );
    expect(tx.status).toBe('cancelled');
    expect(tx.refundTxHash).toBe('0xrefundtx');
  });
});

describe('isRealHash / isRealTransaction', () => {
  test('flags known fake/demo hashes as not real', () => {
    expect(isRealHash('0x1234567890abcdef1234567890abcdef12345678')).toBe(false);
    expect(isRealHash('mock_something')).toBe(false);
    expect(isRealHash('0x0000000000000000000000000000000000000000')).toBe(false);
  });

  test('treats a genuine-looking hash as real', () => {
    expect(isRealHash('0xabc123def4567890')).toBe(true);
    expect(isRealHash(undefined)).toBe(true);
  });

  test('isRealTransaction rejects a transaction with any fake hash', () => {
    const tx = makeLocalTransaction({ ethTxHash: '0x1234567890abcdef1234567890abcdef12345678' });
    expect(isRealTransaction(tx)).toBe(false);
  });
});

describe('mergeTransactions', () => {
  test('dedupes a locally-created order against its coordinator-recovered counterpart by id', () => {
    const local = [makeLocalTransaction()];
    const remote = [mapCoordinatorOrderToTransaction(makeCoordinatorOrder())];

    const merged = mergeTransactions(local, remote);
    expect(merged).toHaveLength(1);
    // Remote (authoritative) data wins.
    expect(merged[0].hashlock).toBe('0xhashlock123');
    expect(merged[0].onChainOrderId).toBe('0xonchainorderid');
  });

  test('dedupes by hashlock even when ids differ', () => {
    const local = [makeLocalTransaction({ id: 'local-temp-id' })];
    const remote = [
      mapCoordinatorOrderToTransaction(makeCoordinatorOrder({ id: 'coordinator-final-id' })),
    ];

    const merged = mergeTransactions(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('coordinator-final-id');
  });

  test('dedupes by on-chain order id when ids and hashlocks differ', () => {
    const local = [
      makeLocalTransaction({ id: 'local-1', onChainOrderId: '0xonchainorderid' }),
    ];
    const remote = [
      mapCoordinatorOrderToTransaction(
        makeCoordinatorOrder({ id: 'remote-1', hashlock: '0xdifferenthashlock' })
      ),
    ];

    const merged = mergeTransactions(local, remote);
    expect(merged).toHaveLength(1);
  });

  test('dedupes by shared tx hash when ids and hashlocks differ', () => {
    const local = [
      makeLocalTransaction({ id: 'local-2', ethTxHash: '0xsharedtxhash', onChainOrderId: undefined }),
    ];
    const remote = [
      mapCoordinatorOrderToTransaction(
        makeCoordinatorOrder({
          id: 'remote-2',
          hashlock: '0xdifferenthashlock',
          src: { ...makeCoordinatorOrder().src, orderId: '0xdifferentorderid', lockTx: '0xsharedtxhash' },
        })
      ),
    ];

    const merged = mergeTransactions(local, remote);
    expect(merged).toHaveLength(1);
  });

  test('keeps genuinely distinct orders separate', () => {
    const local = [makeLocalTransaction({ id: 'order-a', txHash: '0xlocaltxa' })];
    const remote = [
      mapCoordinatorOrderToTransaction(
        makeCoordinatorOrder({
          id: 'order-b',
          hashlock: '0xotherhashlock',
          src: { ...makeCoordinatorOrder().src, orderId: '0xotherorderid', lockTx: '0xothertx' },
        })
      ),
    ];

    const merged = mergeTransactions(local, remote);
    expect(merged).toHaveLength(2);
  });

  test('sorts merged results by most recent timestamp first', () => {
    const older = makeLocalTransaction({ id: 'older', txHash: '0xoldertx', timestamp: 1000 });
    const newer = makeLocalTransaction({ id: 'newer', txHash: '0xnewertx', timestamp: 2000 });

    const merged = mergeTransactions([older], [newer]);
    expect(merged.map((t) => t.id)).toEqual(['newer', 'older']);
  });
});

describe('fetchCoordinatorOrders', () => {
  test('queries the coordinator once per connected address and merges results', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('address=0xEth')) {
        return {
          ok: true,
          json: async () => ({ transactions: [makeCoordinatorOrder({ id: 'eth-order' })] }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ transactions: [makeCoordinatorOrder({ id: 'stellar-order' })] }),
      } as Response;
    }) as typeof fetch;

    const result = await fetchCoordinatorOrders(
      'https://coordinator.example',
      { ethAddress: '0xEth', stellarAddress: 'GSTELLAR' },
      fetchImpl
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/api/orders/history?address=0xEth');
    expect(calls[1]).toContain('/api/orders/history?address=GSTELLAR');
    expect(result.map((t) => t.id).sort()).toEqual(['eth-order', 'stellar-order']);
  });

  test('returns an empty list when no addresses are connected', async () => {
    const fetchImpl = (async () => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;

    const result = await fetchCoordinatorOrders('https://coordinator.example', {}, fetchImpl);
    expect(result).toEqual([]);
  });

  test('throws when every request fails, so callers can fall back to the local cache', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as typeof fetch;

    await expect(
      fetchCoordinatorOrders('https://coordinator.example', { ethAddress: '0xEth' }, fetchImpl)
    ).rejects.toThrow();
  });

  test('still returns data from the address that succeeded when the other fails', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('address=0xEth')) {
        return {
          ok: true,
          json: async () => ({ transactions: [makeCoordinatorOrder({ id: 'eth-order' })] }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await fetchCoordinatorOrders(
      'https://coordinator.example',
      { ethAddress: '0xEth', stellarAddress: 'GSTELLAR' },
      fetchImpl
    );

    expect(result.map((t) => t.id)).toEqual(['eth-order']);
  });

  test('filters out orders with fabricated/demo hashes', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({
        transactions: [
          makeCoordinatorOrder({
            id: 'fake-order',
            src: {
              ...makeCoordinatorOrder().src,
              lockTx: '0x1234567890abcdef1234567890abcdef12345678',
            },
          }),
        ],
      }),
    }) as Response) as typeof fetch;

    const result = await fetchCoordinatorOrders(
      'https://coordinator.example',
      { ethAddress: '0xEth' },
      fetchImpl
    );

    expect(result).toEqual([]);
  });
});
