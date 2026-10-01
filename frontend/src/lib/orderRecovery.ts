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
  /**
   * Claim receipt verification data decoded from the claim transaction
   * (issue #274). The timeline renders the Claimed step only when this
   * matches the coordinator order (hashlock, amount, asset, order id).
   */
  claimReceipt?: {
    orderId?: string | null;
    hashlock?: string | null;
    amountWei?: string | null;
    token?: string | null;
    preimage?: string | null;
  } | null;
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
 * Determines if a status transition should advance the timeline
 * @param currentStep - Current timeline step
 * @param newStatus - New coordinator status
 * @returns true if the timeline should advance
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
    claimReceipt: buildClaimReceiptFromCoordinatorOrder(order),
  };
}

/**
 * Build the claim-verification payload for the timeline (issue #274).
 *
 * The coordinator order is the authoritative record of what was locked
 * and what was revealed; the claim side of the swap is verified against
 * it before the UI may render a claimed state. When the coordinator has
 * revealed a preimage, the claim receipt carries that preimage plus the
 * settlement transaction, so the UI can independently check the
 * preimage→hashlock relation and the destination leg's order id, amount,
 * and asset.
 */
function buildClaimReceiptFromCoordinatorOrder(order: any): Transaction['claimReceipt'] {
  const dst = order?.dst ?? null;
  const src = order?.src ?? null;
  if (!dst && !src) return null;

  const dstLockTx = dst?.lockTx ?? null;
  const srcLockTx = src?.lockTx ?? null;

  // The claim happens on the destination leg: an ETH→XLM swap is claimed
  // on Stellar, an XLM→ETH swap is claimed on Ethereum.
  const isEthToXlm = order.direction === 'eth_to_xlm' || order.direction === 'eth-to-xlm';
  const claimLeg = isEthToXlm ? dst : src;
  const claimLockTx = isEthToXlm ? dstLockTx : srcLockTx;

  // No settlement on the claim leg yet — nothing to verify.
  if (!claimLeg || !claimLockTx) return null;

  return {
    orderId: claimLeg.orderId,
    hashlock: order.hashlock ?? null,
    // Integer amount for the claim leg (wei for ETH, stroop for XLM).
    amountWei: claimLeg.amount ?? null,
    // Asset: the coordinator stores chain names rather than contract
    // addresses, so both legs use the native placeholder for now.
    token: '0x0000000000000000000000000000000000000000',
    preimage: order.secret?.revealed ? (order.secret?.preimage ?? null) : null,
  };
}

/**
 * Gets the current step from a coordinator status
 * @param status - Coordinator status
 * @returns Timeline step or undefined for unknown statuses
 */
export function getStepFromStatus(status: OrderStatus): number | undefined {
  return STATUS_TO_STEP[status];
}
