/**
 * orderRecovery.ts
 *
 * Frontend-side recovery of pending/refundable swaps from the coordinator
 * API. This is what lets a user close the tab (or lose localStorage) and
 * still see — and refund — their in-flight orders after reconnecting a
 * wallet.
 *
 * The coordinator's `/api/orders/history` endpoint only accepts a single
 * `address` query param and matches it against either side of the order
 * (`src_address` OR `dst_address`). Since a swap always has one Ethereum
 * address and one Stellar address, recovering "everything for this user"
 * means issuing one request per connected address and merging the results.
 *
 * No RPC calls are made here — everything comes from the coordinator's
 * persisted order state.
 */

import { isTestnet } from '../config/networks';
import { computeRefundEligibility, type RefundEligibilityResult } from '@oversync/sdk';

export interface Transaction {
  id: string;
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
  /** sha256 hashlock as returned by the coordinator, when known. */
  hashlock?: string;
  // Refund support
  // ETH-side refund metadata (eth-to-xlm; populated when ETH is locked on-chain)
  onChainOrderId?: string; // bytes32 hex (v1) or uint256 string (v2)
  htlcContractAddress?: string; // contract holding the locked ETH
  htlcContractMode?: 'v1-mainnet-htlc' | 'v2-escrow';
  timelockUnixSeconds?: number;
  amountWei?: string;
  // Generic refund tracking (works for both directions)
  refundTxHash?: string;
  refundNetwork?: 'ethereum' | 'stellar'; // which chain the refund lives on
  refundedAt?: number;
  autoRefundFailed?: boolean;
  autoRefundError?: string;
  networkMode?: 'mainnet' | 'testnet';
  refundEligibility?: RefundEligibilityResult;
}

export interface RecoveryAddresses {
  ethAddress?: string;
  stellarAddress?: string;
}

// Hash patterns that indicate fabricated/demo data, used to filter out legacy
// entries persisted by older builds. New entries can never match these
// because v2 only stores real on-chain hashes returned from the coordinator.
const KNOWN_FAKE_HASHES = new Set([
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xabcdef1234567890abcdef1234567890abcdef12',
  '0x9876543210fedcba9876543210fedcba98765432',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000',
]);

export function isRealHash(hash?: string): boolean {
  if (!hash) return true;
  if (KNOWN_FAKE_HASHES.has(hash)) return false;
  if (hash.startsWith('mock_')) return false;
  if (hash.startsWith('placeholder')) return false;
  if (/^0x0+$/.test(hash)) return false;
  return true;
}

export function isRealTransaction(tx: Transaction): boolean {
  return isRealHash(tx.txHash) && isRealHash(tx.ethTxHash) && isRealHash(tx.stellarTxHash);
}

/**
 * Map a raw coordinator order (as serialised by
 * `coordinator/src/server/routes/orders.ts`) into the UI's `Transaction`
 * shape. Locally-created transactions are passed through unchanged (they
 * already have `fromToken`/`fromNetwork`).
 */
export function mapCoordinatorOrderToTransaction(order: any): Transaction {
  if (order.fromToken || order.fromNetwork) {
    return order as Transaction;
  }

  const isEthToXlm = order.direction === 'eth_to_xlm' || order.direction === 'eth-to-xlm';
  const isTestnetMode = isTestnet();

  let status: Transaction['status'] = 'pending';
  if (order.status === 'completed') {
    status = 'completed';
  } else if (order.status === 'failed' || order.status === 'expired') {
    status = 'failed';
  } else if (order.status === 'refunded') {
    status = 'cancelled';
  }

  const srcAmount = order.src?.amount
    ? (isEthToXlm ? parseFloat(order.src.amount) / 1e18 : parseFloat(order.src.amount) / 1e7).toString()
    : '0';
  const dstAmount = order.dst?.amount
    ? (isEthToXlm ? parseFloat(order.dst.amount) / 1e7 : parseFloat(order.dst.amount) / 1e18).toString()
    : '0';

  return {
    id: order.id,
    txHash: order.src?.lockTx || order.id,
    fromNetwork: isEthToXlm
      ? (isTestnetMode ? 'ETH Sepolia' : 'ETH Mainnet')
      : (isTestnetMode ? 'Stellar Testnet' : 'Stellar Mainnet'),
    toNetwork: isEthToXlm
      ? (isTestnetMode ? 'Stellar Testnet' : 'Stellar Mainnet')
      : (isTestnetMode ? 'ETH Sepolia' : 'ETH Mainnet'),
    fromToken: isEthToXlm ? 'ETH' : 'XLM',
    toToken: isEthToXlm ? 'XLM' : 'ETH',
    amount: srcAmount,
    estimatedAmount: dstAmount,
    status,
    timestamp: order.createdAt ? order.createdAt * 1000 : Date.now(),
    ethTxHash: isEthToXlm ? order.src?.lockTx : order.dst?.lockTx,
    stellarTxHash: isEthToXlm ? order.dst?.lockTx : order.src?.lockTx,
    ethAddress: isEthToXlm ? order.src?.address : order.dst?.address,
    stellarAddress: isEthToXlm ? order.dst?.address : order.src?.address,
    direction: isEthToXlm ? 'eth-to-xlm' : 'xlm-to-eth',
    hashlock: order.hashlock,
    onChainOrderId: order.src?.orderId,
    htlcContractAddress: order.src?.chain === 'ethereum' ? order.resolver : undefined,
    htlcContractMode: order.src?.safetyDeposit ? 'v2-escrow' : 'v1-mainnet-htlc',
    timelockUnixSeconds: order.src?.timelock,
    amountWei: order.src?.amount,
    refundTxHash: order.status === 'refunded' ? order.secret?.revealedTx : undefined,
    refundNetwork: isEthToXlm ? 'ethereum' : 'stellar',
    refundedAt: order.status === 'refunded' ? order.updatedAt * 1000 : undefined,
    networkMode: isTestnetMode ? 'testnet' : 'mainnet',
    refundEligibility: order.refundEligibility ?? computeRefundEligibility({
      status: order.status,
      timelock: order.src?.timelock,
      direction: order.direction,
    }),
  };
}

/**
 * Fetch every order the coordinator knows about for the connected
 * addresses. Issues one request per address (the coordinator only
 * supports a single `address` filter) and merges/dedupes the raw results
 * by `id` before mapping them into `Transaction`s.
 *
 * Throws if every request fails so callers can fall back to cached data.
 */
export async function fetchCoordinatorOrders(
  apiBase: string,
  addresses: RecoveryAddresses,
  fetchImpl: typeof fetch = fetch
): Promise<Transaction[]> {
  const targets = [addresses.ethAddress, addresses.stellarAddress].filter(
    (a): a is string => Boolean(a)
  );
  if (targets.length === 0) return [];

  const settled = await Promise.allSettled(
    targets.map(async (address) => {
      const params = new URLSearchParams({ address, limit: '50' });
      const res = await fetchImpl(`${apiBase}/api/orders/history?${params.toString()}`);
      if (!res.ok) throw new Error(`Coordinator returned ${res.status}`);
      const body = await res.json();
      return Array.isArray(body?.transactions) ? body.transactions : [];
    })
  );

  const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failures.length === settled.length) {
    // Every request failed — surface the first error so callers can fall
    // back to the local cache instead of silently showing an empty list.
    throw failures[0].reason;
  }

  const byId = new Map<string, any>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const order of result.value) {
      if (order?.id) byId.set(order.id, order);
    }
  }

  return Array.from(byId.values())
    .map(mapCoordinatorOrderToTransaction)
    .filter(isRealTransaction);
}

/**
 * Build the set of identifiers a transaction can be recognised by. Two
 * transactions that share any signal are considered the same underlying
 * order — this is what lets a locally-created pending swap (which only
 * knows its `id`/tx hashes) merge cleanly with the richer record the
 * coordinator returns after recovery (which also carries `hashlock` and
 * `onChainOrderId`).
 */
function transactionSignals(tx: Transaction): string[] {
  const signals: string[] = [`id:${tx.id}`];
  if (tx.hashlock) signals.push(`hashlock:${tx.hashlock}`);
  if (tx.onChainOrderId) signals.push(`orderid:${tx.onChainOrderId}`);
  if (tx.txHash && isRealHash(tx.txHash)) signals.push(`tx:${tx.txHash}`);
  if (tx.ethTxHash && isRealHash(tx.ethTxHash)) signals.push(`tx:${tx.ethTxHash}`);
  if (tx.stellarTxHash && isRealHash(tx.stellarTxHash)) signals.push(`tx:${tx.stellarTxHash}`);
  return signals;
}

/**
 * Merge locally-created transactions with orders recovered from the
 * coordinator, de-duplicating by hashlock / on-chain order id / tx hash
 * (falling back to `id`). When both sides describe the same order, the
 * coordinator's version wins since it reflects authoritative on-chain
 * state (lock tx hashes, timelocks, refund status, etc).
 *
 * Order is preserved by most recent `timestamp` first.
 */
export function mergeTransactions(local: Transaction[], remote: Transaction[]): Transaction[] {
  const merged: Transaction[] = [];
  const signalToIndex = new Map<string, number>();

  const upsert = (tx: Transaction) => {
    const signals = transactionSignals(tx);
    let index = -1;
    for (const signal of signals) {
      const existing = signalToIndex.get(signal);
      if (existing !== undefined) {
        index = existing;
        break;
      }
    }

    if (index === -1) {
      index = merged.length;
      merged.push(tx);
    } else {
      merged[index] = { ...merged[index], ...tx };
    }

    for (const signal of signals) {
      signalToIndex.set(signal, index);
    }
  };

  for (const tx of local) upsert(tx);
  for (const tx of remote) upsert(tx);

  return merged.sort((a, b) => b.timestamp - a.timestamp);
}
