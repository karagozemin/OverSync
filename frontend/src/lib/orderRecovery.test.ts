import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  coordinatorOrderToTransaction,
  deduplicateTransactions,
  fetchRecoveredOrders,
  getDeduplicationKey,
  type TransactionFromCoordinator,
} from '../lib/orderRecovery';
import type { Order } from '@oversync/sdk';

describe('Order Recovery', () => {
  describe('coordinatorOrderToTransaction', () => {
    it('should convert eth-to-xlm order with refund metadata', () => {
      const order: Order = {
        publicId: 'test-order-123',
        direction: 'eth_to_xlm',
        status: 'src_locked',
        hashlock: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        preimage: null,
        createdAt: 1234567890,
        src: {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
          asset: 'ETH',
          amount: '1000000000000000000',
          safetyDeposit: '100000000000000000',
          orderId: '42',
          lockTx: '0x123456789abcdef',
          timelock: 1234567890,
        },
        dst: {
          chain: 'stellar',
          address: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJgpesqwvmt46FDUA26WMNBTM',
          asset: 'XLM',
          amount: '5000000000',
        },
      };

      const tx = coordinatorOrderToTransaction(order);

      expect(tx.id).toBe('test-order-123');
      expect(tx.direction).toBe('eth-to-xlm');
      expect(tx.status).toBe('pending');
      expect(tx.onChainOrderId).toBe('42');
      expect(tx.timelockUnixSeconds).toBe(1234567890);
      expect(tx.amountWei).toBe('1000000000000000000');
      expect(tx.ethTxHash).toBe('0x123456789abcdef');
      expect(tx.htlcContractMode).toBe('v2-escrow');
    });

    it('should detect v1-mainnet-htlc contract mode from 0x-prefixed 32-byte orderId', () => {
      const order: Order = {
        publicId: 'test-order-v1',
        direction: 'eth_to_xlm',
        status: 'src_locked',
        hashlock: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        preimage: null,
        createdAt: 1234567890,
        src: {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
          asset: 'ETH',
          amount: '1000000000000000000',
          safetyDeposit: '100000000000000000',
          orderId: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          lockTx: '0x123456789abcdef',
          timelock: 1234567890,
        },
        dst: {
          chain: 'stellar',
          address: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJGPESQWVMT46FDUA26WMNBTM',
          asset: 'XLM',
          amount: '5000000000',
        },
      };

      const tx = coordinatorOrderToTransaction(order);

      expect(tx.htlcContractMode).toBe('v1-mainnet-htlc');
    });

    it('should not populate refund metadata for announced orders (not src_locked)', () => {
      const order: Order = {
        publicId: 'announced-order',
        direction: 'eth_to_xlm',
        status: 'announced',
        hashlock: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        preimage: null,
        createdAt: 1234567890,
        src: {
          chain: 'ethereum',
          address: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
          asset: 'ETH',
          amount: '1000000000000000000',
          safetyDeposit: '100000000000000000',
        },
        dst: {
          chain: 'stellar',
          address: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJGPESQWVMT46FDUA26WMNBTM',
          asset: 'XLM',
          amount: '5000000000',
        },
      };

      const tx = coordinatorOrderToTransaction(order);

      expect(tx.onChainOrderId).toBeUndefined();
      expect(tx.timelockUnixSeconds).toBeUndefined();
    });
  });

  describe('getDeduplicationKey', () => {
    it('should use hashlock as primary key', () => {
      const tx: TransactionFromCoordinator = {
        id: '0x1234567890abcdef',
        txHash: 'tx1',
        fromNetwork: 'ethereum',
        toNetwork: 'stellar',
        fromToken: 'ETH',
        toToken: 'XLM',
        amount: '1',
        estimatedAmount: '5',
        status: 'pending',
        timestamp: Date.now(),
        direction: 'eth-to-xlm',
      };

      const key = getDeduplicationKey(tx);
      expect(key).toBe('hashlock:0x1234567890abcdef');
    });

    it('should use orderkey for orders with onChainOrderId', () => {
      const tx: TransactionFromCoordinator = {
        id: 'order-123',
        txHash: 'tx1',
        fromNetwork: 'ethereum',
        toNetwork: 'stellar',
        fromToken: 'ETH',
        toToken: 'XLM',
        amount: '1',
        estimatedAmount: '5',
        status: 'pending',
        timestamp: Date.now(),
        direction: 'eth-to-xlm',
        onChainOrderId: 'order-456',
        ethTxHash: '0xabc',
      };

      const key = getDeduplicationKey(tx);
      expect(key).toContain('orderkey:');
      expect(key).toContain('order-456');
    });

    it('should use txhash as fallback', () => {
      const tx: TransactionFromCoordinator = {
        id: 'order-123',
        txHash: 'unique-tx-hash',
        fromNetwork: 'ethereum',
        toNetwork: 'stellar',
        fromToken: 'ETH',
        toToken: 'XLM',
        amount: '1',
        estimatedAmount: '5',
        status: 'pending',
        timestamp: Date.now(),
        direction: 'eth-to-xlm',
      };

      const key = getDeduplicationKey(tx);
      expect(key).toBe('txhash:unique-tx-hash');
    });
  });

  describe('deduplicateTransactions', () => {
    it('should merge local and recovered orders without duplicates', () => {
      const local: TransactionFromCoordinator[] = [
        {
          id: 'local-1',
          txHash: 'tx1',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '1',
          estimatedAmount: '5',
          status: 'pending',
          timestamp: 1000,
          direction: 'eth-to-xlm',
          onChainOrderId: 'order-123',
        },
      ];

      const recovered: TransactionFromCoordinator[] = [
        {
          id: 'local-1', // Same order ID as local
          txHash: 'tx1',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '1',
          estimatedAmount: '5',
          status: 'completed', // Updated status
          timestamp: 1000,
          direction: 'eth-to-xlm',
          onChainOrderId: 'order-123',
        },
      ];

      const merged = deduplicateTransactions(local, recovered);

      expect(merged).toHaveLength(1);
      expect(merged[0].status).toBe('completed');
    });

    it('should preserve local refund state when merging', () => {
      const local: TransactionFromCoordinator[] = [
        {
          id: 'order-1',
          txHash: 'tx1',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '1',
          estimatedAmount: '5',
          status: 'pending',
          timestamp: 1000,
          direction: 'eth-to-xlm',
          refundTxHash: '0xrefund123',
          refundedAt: 2000,
        },
      ];

      const recovered: TransactionFromCoordinator[] = [
        {
          id: 'order-1',
          txHash: 'tx1',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '1',
          estimatedAmount: '5',
          status: 'completed', // Different status
          timestamp: 1000,
          direction: 'eth-to-xlm',
          // No refund info
        },
      ];

      const merged = deduplicateTransactions(local, recovered);

      expect(merged).toHaveLength(1);
      expect(merged[0].refundTxHash).toBe('0xrefund123');
      expect(merged[0].refundedAt).toBe(2000);
    });

    it('should add new recovered orders not in local history', () => {
      const local: TransactionFromCoordinator[] = [
        {
          id: 'local-1',
          txHash: 'tx1',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '1',
          estimatedAmount: '5',
          status: 'pending',
          timestamp: 1000,
          direction: 'eth-to-xlm',
        },
      ];

      const recovered: TransactionFromCoordinator[] = [
        {
          id: 'recovered-1',
          txHash: 'tx-recovered',
          fromNetwork: 'ethereum',
          toNetwork: 'stellar',
          fromToken: 'ETH',
          toToken: 'XLM',
          amount: '2',
          estimatedAmount: '10',
          status: 'pending',
          timestamp: 2000,
          direction: 'eth-to-xlm',
        },
      ];

      const merged = deduplicateTransactions(local, recovered);

      expect(merged).toHaveLength(2);
      expect(merged.map(t => t.id)).toContain('local-1');
      expect(merged.map(t => t.id)).toContain('recovered-1');
    });
  });

  describe('fetchRecoveredOrders', () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it('should fetch orders for both eth and stellar addresses', async () => {
      const mockOrders = {
        transactions: [
          {
            publicId: 'order-1',
            direction: 'eth_to_xlm',
            status: 'src_locked',
            hashlock: '0xabcd',
            src: {
              chain: 'ethereum',
              address: '0x123',
              asset: 'ETH',
              amount: '1',
              orderId: '1',
              lockTx: '0xtx1',
              timelock: 1000,
            },
            dst: {
              chain: 'stellar',
              address: 'GTEST',
              asset: 'XLM',
              amount: '5',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockOrders,
      });

      const orders = await fetchRecoveredOrders(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJGPESQWVMT46FDUA26WMNBTM',
        'http://localhost:8000'
      );

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8000/api/orders/history')
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe('order-1');
    });

    it('should return empty array on coordinator failure', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const orders = await fetchRecoveredOrders(
        '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        undefined,
        'http://localhost:8000'
      );

      expect(orders).toHaveLength(0);
    });

    it('should return empty array when no addresses provided', async () => {
      const orders = await fetchRecoveredOrders(undefined, undefined, 'http://localhost:8000');

      expect(orders).toHaveLength(0);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
