/**
 * Order recovery and deduplication utilities for merging coordinator-recovered
 * orders with locally-stored transaction history.
 */

import type { Order } from '@oversync/sdk';
import { isTestnet } from '../config/networks';

export interface TransactionFromCoordinator {
  id: string; // publicId
  txHash: string;
  fromNetwork: string;
  toNetwork: string;
  fromToken: string;
  toToken: string;
  amount: string;
  estimatedAmount: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  timestamp: number;
  ethTxHash?: string;
  stellarTxHash?: string;
  ethAddress?: string;
  stellarAddress?: string;
  direction: 'eth-to-xlm' | 'xlm-to-eth';
  onChainOrderId?: string;
  htlcContractAddress?: string;
  htlcContractMode?: 'v1-mainnet-htlc' | 'v2-escrow';
  timelockUnixSeconds?: number;
  amountWei?: string;
  refundTxHash?: string;
  refundNetwork?: 'ethereum' | 'stellar';
  refundedAt?: number;
  autoRefundFailed?: boolean;
  autoRefundError?: string;
  networkMode?: 'mainnet' | 'testnet';
}

/**
 * Convert a coordinator Order (from SDK) to a frontend Transaction for display.
 * This populates refund metadata when available (for eth-to-xlm with src locked).
 */
export function coordinatorOrderToTransaction(
  order: Order,
  _ethAddress?: string,
  _stellarAddress?: string
): TransactionFromCoordinator {
  const isEthToXlm = order.direction === 'eth_to_xlm';
  const direction: 'eth-to-xlm' | 'xlm-to-eth' = isEthToXlm ? 'eth-to-xlm' : 'xlm-to-eth';

  // Map coordinator status to frontend status
  const statusMap: Record<string, 'pending' | 'completed' | 'cancelled' | 'failed'> = {
    announced: 'pending',
    src_locked: 'pending',
    dst_locked: 'pending',
    secret_revealed: 'pending',
    completed: 'completed',
    refunded: 'cancelled',
    failed: 'failed',
    expired: 'pending', // Can be refunded
  };

  const status = statusMap[order.status] || 'pending';
  const createdAtMs = (order.src.lockTx ? Number(order.src.timelock) || 0 : order.createdAt) * 1000;

  // For eth-to-xlm swaps, populate refund metadata from the source (Ethereum) leg
  // The HTLC contract address comes from environment configuration
  const ethRefundMeta = isEthToXlm && order.src.orderId
    ? {
        onChainOrderId: order.src.orderId,
        // htlcContractAddress should be fetched from env config if needed
        // For now, it will be set by the component caller if necessary
        htlcContractAddress: undefined as any, // Will be populated from env by caller
        htlcContractMode: detectContractMode(order.src.orderId) as 'v1-mainnet-htlc' | 'v2-escrow',
        timelockUnixSeconds: order.src.timelock || undefined,
        amountWei: order.src.amount,
      }
    : {};

  return {
    id: order.publicId,
    txHash: order.src.lockTx || order.publicId,
    fromNetwork: isEthToXlm ? 'ethereum' : 'stellar',
    toNetwork: isEthToXlm ? 'stellar' : 'ethereum',
    fromToken: order.src.asset,
    toToken: order.dst.asset,
    amount: order.src.amount,
    estimatedAmount: order.dst.amount,
    status,
    timestamp: createdAtMs,
    ethTxHash: (isEthToXlm ? order.src.lockTx : order.dst.lockTx) || undefined,
    stellarTxHash: (isEthToXlm ? order.dst.lockTx : order.src.lockTx) || undefined,
    ethAddress: isEthToXlm ? order.src.address : order.dst.address,
    stellarAddress: isEthToXlm ? order.dst.address : order.src.address,
    direction,
    ...ethRefundMeta,
    networkMode: isTestnet() ? 'testnet' : 'mainnet',
  };
}

/**
 * Detect contract mode from order ID format:
 * - 0x-prefixed 32-byte hex: v1-mainnet-htlc (bytes32)
 * - Other decimal string: v2-escrow (uint256)
 */
function detectContractMode(orderId: string): 'v1-mainnet-htlc' | 'v2-escrow' {
  if (orderId.startsWith('0x') && orderId.length === 66) {
    return 'v1-mainnet-htlc';
  }
  return 'v2-escrow';
}

/**
 * Deduplication key for an order/transaction.
 * Used to identify duplicate entries when merging local and recovered orders.
 */
export function getDeduplicationKey(tx: TransactionFromCoordinator): string {
  // Order by priority: hashlock > orderId combo > tx hash
  if (tx.id && tx.id.startsWith('0x')) {
    return `hashlock:${tx.id}`;
  }
  if (tx.onChainOrderId || (tx.ethTxHash && tx.stellarTxHash)) {
    const key = [tx.onChainOrderId, tx.ethTxHash, tx.stellarTxHash].filter(Boolean).join(':');
    if (key) return `orderkey:${key}`;
  }
  if (tx.txHash) {
    return `txhash:${tx.txHash}`;
  }
  return `unique:${Math.random()}`;
}

/**
 * Merge recovered orders from the coordinator with local transaction history.
 * Prioritizes recovered data (more authoritative) but preserves local refund state.
 */
export function deduplicateTransactions(
  local: TransactionFromCoordinator[],
  recovered: TransactionFromCoordinator[]
): TransactionFromCoordinator[] {
  const byDedup = new Map<string, TransactionFromCoordinator>();

  // Process local transactions first (lower priority)
  for (const tx of local) {
    const key = getDeduplicationKey(tx);
    if (!byDedup.has(key)) {
      byDedup.set(key, tx);
    }
  }

  // Merge in recovered transactions, preferring recovered data but keeping local refund state
  for (const rec of recovered) {
    const key = getDeduplicationKey(rec);
    const existing = byDedup.get(key);

    if (existing) {
      // Merge: prefer recovered order data, but preserve local refund metadata
      const merged: TransactionFromCoordinator = {
        ...rec,
        // Keep local refund state if it exists
        refundTxHash: existing.refundTxHash || rec.refundTxHash,
        refundNetwork: existing.refundNetwork || rec.refundNetwork,
        refundedAt: existing.refundedAt || rec.refundedAt,
        autoRefundFailed: existing.autoRefundFailed !== undefined
          ? existing.autoRefundFailed
          : rec.autoRefundFailed,
      };
      byDedup.set(key, merged);
    } else {
      // New recovered order
      byDedup.set(key, rec);
    }
  }

  return Array.from(byDedup.values());
}

/**
 * Fetch orders for both Ethereum and Stellar addresses in a single request
 * (if both are provided) or separate requests (for backwards compatibility).
 */
export async function fetchRecoveredOrders(
  ethAddress: string | undefined,
  stellarAddress: string | undefined,
  apiBase: string
): Promise<TransactionFromCoordinator[]> {
  try {
    const params = new URLSearchParams();
    if (ethAddress) params.set('eth', ethAddress);
    if (stellarAddress) params.set('stellar', stellarAddress);
    if (!ethAddress && !stellarAddress) {
      return [];
    }

    const res = await fetch(
      `${apiBase}/api/orders/history?${params.toString()}&limit=100`
    );
    if (!res.ok) {
      console.warn(`Coordinator returned ${res.status}`);
      return [];
    }

    const body = await res.json();
    const orders = Array.isArray(body?.transactions) ? body.transactions : [];

    return orders.map((order: any) =>
      coordinatorOrderToTransaction(order, ethAddress, stellarAddress)
    );
  } catch (err) {
    console.warn('Failed to fetch coordinator orders:', err);
    return [];
  }
}
