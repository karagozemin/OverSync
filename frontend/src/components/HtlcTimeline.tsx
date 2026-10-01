import { CheckCircle2, Clock, XCircle, Loader2, ExternalLink, Shield } from 'lucide-react';
import { isTestnet } from '../config/networks';
import { receiptMatchesOrder, preimageMatchesHashlock, type HtlcOrderMatchField } from '../lib/parseHtlcReceipt';

export interface HtlcTimelineProps {
  tx: {
    id: string;
    txHash: string;
    fromNetwork: string;
    toNetwork: string;
    fromToken: string;
    toToken: string;
    amount: string;
    estimatedAmount: string;
    status: 'pending' | 'completed' | 'cancelled' | 'failed' | string;
    timestamp: number;
    ethTxHash?: string;
    stellarTxHash?: string;
    direction: 'eth-to-xlm' | 'xlm-to-eth';
    timelockUnixSeconds?: number;
    refundTxHash?: string;
    refundNetwork?: 'ethereum' | 'stellar';
    refundedAt?: number;
    autoRefundFailed?: boolean;
    autoRefundError?: string;
    networkMode?: 'mainnet' | 'testnet';
    /** Claim receipt verification data (issue #274). */
    claimReceipt?: {
      /** On-chain order id decoded from the claim log. */
      orderId?: string | null;
      /** sha256/keccak256 hashlock the order's funds are locked under. */
      hashlock?: string | null;
      /** Integer amount (wei/stroop) locked for this leg. */
      amountWei?: string | null;
      /** Asset contract address, or the native placeholder. */
      token?: string | null;
      /** Preimage revealed by the claim, when the log carries one. */
      preimage?: string | null;
    } | null;
  };
  /** Coordinator order data the claim receipt must match (issue #274). */
  order?: {
    orderId?: string | null;
    hashlock?: string | null;
    amountWei?: string | null;
    token?: string | null;
  } | null;
  currentStellarAddress?: string;
}

interface TimelineStep {
  key: string;
  label: string;
  description: string;
  status: 'completed' | 'active' | 'pending' | 'unavailable' | 'failed' | 'unverified';
  txHash?: string;
  chain?: 'ethereum' | 'stellar';
  /** Populated when a claim was withheld because verification failed. */
  mismatchFields?: HtlcOrderMatchField[];
}

const KNOWN_FAKE_HASHES = new Set([
  '0x1234567890abcdef1234567890abcdef12345678',
  '0xabcdef1234567890abcdef1234567890abcdef12',
  '0x9876543210fedcba9876543210fedcba98765432',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000000',
]);

function isObservedHash(hash?: string): boolean {
  if (!hash) return false;
  if (KNOWN_FAKE_HASHES.has(hash)) return false;
  if (hash.startsWith('mock_')) return false;
  if (hash.startsWith('placeholder')) return false;
  if (/^0x0+$/.test(hash)) return false;
  return true;
}

const getExplorerUrl = (txHash: string, chain: 'ethereum' | 'stellar'): string => {
  if (chain === 'ethereum') {
    const base = isTestnet() ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';
    return `${base}/tx/${txHash}`;
  } else {
    const network = isTestnet() ? 'testnet' : 'public';
    return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  }
};

/**
 * Verify a claim receipt against the coordinator order before the
 * timeline may advance to "Claimed" (issue #274).
 *
 * The claim is rendered only when ALL of the following hold:
 *  1. The receipt's order id, hashlock, amount, and asset match the order.
 *  2. The revealed preimage hashes to the order's hashlock (when a
 *     preimage is available in the claim log).
 *
 * Missing verification data on either side means "unverified", never
 * "claimed" — a receipt for a different swap must not stop the user
 * from waiting on funds that are still locked.
 */
export function verifyClaimForTimeline(
  tx: HtlcTimelineProps['tx'],
  order: HtlcTimelineProps['order']
): { claimed: boolean; mismatches: HtlcOrderMatchField[] } {
  const claim = tx.claimReceipt;

  if (!claim) {
    return { claimed: false, mismatches: [] };
  }

  if (!order) {
    // Without the coordinator order there is nothing to verify against.
    return { claimed: false, mismatches: [] };
  }

  const match = receiptMatchesOrder({
    receipt: {
      orderId: claim.orderId,
      hashlock: claim.hashlock,
      amountWei: claim.amountWei,
      token: claim.token,
    },
    order: {
      orderId: order.orderId,
      hashlock: order.hashlock,
      amountWei: order.amountWei,
      token: order.token,
    },
  });

  if (!match.matched) {
    return { claimed: false, mismatches: match.mismatches };
  }

  // Independent cryptographic check: the preimage revealed by the claim
  // must hash to the order's hashlock. If the claim log carries a
  // preimage, require it to verify; otherwise rely on the field match.
  if (claim.preimage && !preimageMatchesHashlock(claim.preimage, order.hashlock)) {
    return { claimed: false, mismatches: ['hashlock'] };
  }

  return { claimed: true, mismatches: [] };
}

const MISMATCH_LABELS: Record<HtlcOrderMatchField, string> = {
  orderId: 'order id',
  hashlock: 'hashlock',
  amount: 'amount',
  asset: 'asset',
};

export default function HtlcTimeline({ tx, order }: HtlcTimelineProps) {
  const isEthToXlm = tx.direction === 'eth-to-xlm';
  const status = tx.status;

  // Normalise status flags
  const isFailedStatus = status === 'failed' || status === 'expired';
  const isRefundedStatus = status === 'refunded' || status === 'cancelled' || !!tx.refundTxHash || !!tx.refundedAt;

  // Issue #274: the claimed step is rendered only when the claim receipt
  // matches the coordinator order. A coordinator "completed" status alone
  // no longer advances the timeline to Claimed.
  const claimVerification = verifyClaimForTimeline(tx, order);
  const isClaimVerified = claimVerification.claimed;

  const isCompleted = status === 'completed' && isClaimVerified;

  // Check locks
  const hasSrcLock = isEthToXlm
    ? isObservedHash(tx.ethTxHash) || isObservedHash(tx.txHash)
    : isObservedHash(tx.stellarTxHash) || isObservedHash(tx.txHash);

  const hasDstLock = isCompleted || status === 'dst_locked' || status === 'secret_revealed' ||
    (isEthToXlm ? isObservedHash(tx.stellarTxHash) : isObservedHash(tx.ethTxHash));

  // Determine if refund is possible/active
  const isExpired = tx.timelockUnixSeconds ? (Date.now() / 1000) > tx.timelockUnixSeconds : false;
  const isRefundable = (isFailedStatus || isExpired || status === 'expired') && !isRefundedStatus && !isCompleted;

  // Determine if we should show the Refund/Failure path
  const showRefundPath = isFailedStatus || isRefundedStatus || isRefundable;

  const steps: TimelineStep[] = [];

  // Step 1: Order Created (Universal)
  steps.push({
    key: 'created',
    label: 'Order Created',
    description: 'Swap intent registered on-chain.',
    status: 'completed'
  });

  // Step 2: Source Lock Observed
  steps.push({
    key: 'src_locked',
    label: 'Source Lock Observed',
    description: isEthToXlm
      ? 'ETH deposited into the source HTLC smart contract.'
      : 'XLM deposited to the relayer wallet.',
    status: hasSrcLock ? 'completed' : 'pending',
    txHash: isEthToXlm ? (tx.ethTxHash || tx.txHash) : (tx.stellarTxHash || tx.txHash),
    chain: isEthToXlm ? 'ethereum' : 'stellar'
  });

  // Step 3: Destination Lock Observed
  let dstStatus: TimelineStep['status'] = 'pending';
  if (hasDstLock) {
    dstStatus = 'completed';
  } else if (hasSrcLock && !isCompleted && !showRefundPath) {
    dstStatus = 'active'; // Relayer/resolver is locking destination side
  } else if (showRefundPath) {
    dstStatus = 'unavailable'; // Bypassed/failed
  }

  steps.push({
    key: 'dst_locked',
    label: 'Destination Lock Observed',
    description: isEthToXlm
      ? 'Counterparty locked matching XLM in the destination contract.'
      : 'Counterparty locked matching ETH in the destination contract.',
    status: dstStatus,
    txHash: isEthToXlm ? tx.stellarTxHash : tx.ethTxHash,
    chain: isEthToXlm ? 'stellar' : 'ethereum'
  });

  if (!showRefundPath) {
    // Happy Path: Claimable and Claimed

    // Step 4: Claimable
    let claimableStatus: TimelineStep['status'] = 'pending';
    if (isCompleted || status === 'secret_revealed') {
      claimableStatus = 'completed';
    } else if (hasDstLock) {
      claimableStatus = 'active'; // Claim signature can be submitted
    }

    steps.push({
      key: 'claimable',
      label: 'Claimable',
      description: 'Funds are unlocked and ready to claim in the destination wallet.',
      status: claimableStatus
    });

    // Step 5: Claimed — gated on receipt↔order verification (issue #274)
    let claimedStatus: TimelineStep['status'] = 'pending';
    if (isCompleted) {
      claimedStatus = 'completed';
    } else if (tx.claimReceipt && !isClaimVerified) {
      // A claim receipt exists but does not match this order — show it as
      // unverified instead of silently claiming, or throwing a raw dump.
      claimedStatus = 'unverified';
    } else if (status === 'secret_revealed') {
      claimedStatus = 'active'; // Claim is settling
    }

    steps.push({
      key: 'claimed',
      label: 'Claimed',
      description: claimedStatus === 'unverified'
        ? `Claim receipt withheld: ${claimVerification.mismatches
            .map((f) => MISMATCH_LABELS[f])
            .join(', ')} does not match this order.`
        : 'Funds successfully claimed from the HTLC contract by the receiver.',
      status: claimedStatus,
      txHash: isEthToXlm ? tx.stellarTxHash : tx.ethTxHash,
      chain: isEthToXlm ? 'stellar' : 'ethereum'
    });

  } else {
    // Unhappy Path: Expired/Failed, Refundable, Refunded

    // Step 4: Expired / Failed
    steps.push({
      key: 'failed',
      label: 'Expired / Failed',
      description: tx.autoRefundError || 'Swap failed to complete within the timelock window.',
      status: 'failed'
    });

    // Step 5: Refundable
    let refundableStatus: TimelineStep['status'] = 'pending';
    if (isRefundedStatus) {
      refundableStatus = 'completed';
    } else if (isRefundable) {
      refundableStatus = 'active'; // Reclaim action is ready
    }

    steps.push({
      key: 'refundable',
      label: 'Refundable',
      description: 'Lock duration has expired. Deposit can be reclaimed from the contract.',
      status: refundableStatus
    });

    // Step 6: Refunded
    let refundedStatus: TimelineStep['status'] = 'pending';
    if (isRefundedStatus) {
      refundedStatus = 'completed';
    } else if (isRefundable) {
      refundedStatus = 'active'; // Reclaim action is ready
    }

    steps.push({
      key: 'refunded',
      label: 'Refunded',
      description: 'Locked deposit successfully returned to the original depositor\'s wallet.',
      status: refundedStatus,
      txHash: tx.refundTxHash,
      chain: tx.refundNetwork || (isEthToXlm ? 'ethereum' : 'stellar')
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 font-sans text-sm glass-effect" data-testid="htlc-timeline" data-tx-id={tx.id}>
      <div className="mb-4 flex items-center gap-2 border-b border-white/5 pb-2">
        <Shield className="h-4 w-4 text-cyan-400" />
        <h4 className="font-semibold text-white">HTLC Swap Lifecycle Timeline</h4>
        <span className="ml-auto rounded-full bg-cyan-500/10 px-2 py-0.5 text-2xs font-medium text-cyan-300 capitalize">
          {tx.direction.replace('-', ' → ')}
        </span>
      </div>

      <div className="relative flex flex-col gap-6 pl-6">
        {/* Timeline connector track */}
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-white/10" />

        {steps.map((step, idx) => {
          const isObserved = step.txHash && isObservedHash(step.txHash);
          const showLink = isObserved && step.chain;

          return (
            <div key={step.key} className="relative flex flex-col gap-1 transition-all duration-200" data-testid={`htlc-step-${step.key}`} data-step-status={step.status}>
              {/* Step indicator node */}
              <div className="absolute -left-[20px] top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-[#0d1527]">
                {step.status === 'completed' && (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 fill-emerald-500/10" />
                )}
                {step.status === 'active' && (
                  <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                )}
                {step.status === 'pending' && (
                  <Clock className="h-4 w-4 text-slate-500" />
                )}
                {step.status === 'unavailable' && (
                  <Clock className="h-4 w-4 text-slate-700 opacity-60" />
                )}
                {step.status === 'unverified' && (
                  <Shield className="h-4 w-4 text-amber-400" />
                )}
                {step.status === 'failed' && (
                  <XCircle className="h-5 w-5 text-red-400 fill-red-500/10" />
                )}
              </div>

              {/* Connecting line fill for completed steps */}
              {idx < steps.length - 1 && steps[idx + 1].status !== 'pending' && steps[idx + 1].status !== 'unavailable' && (
                <div className="absolute -left-[14px] top-6 h-8 w-0.5 bg-gradient-to-b from-emerald-400 to-cyan-400" />
              )}

              {/* Title & Status */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-semibold ${
                  step.status === 'completed' ? 'text-white' :
                  step.status === 'active' ? 'text-cyan-300' :
                  step.status === 'unverified' ? 'text-amber-300' :
                  step.status === 'failed' ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {step.label}
                </span>

                {step.status === 'active' && (
                  <span className="animate-pulse rounded-full bg-cyan-400/15 px-1.5 py-0.5 text-3xs font-medium text-cyan-300">
                    Processing
                  </span>
                )}
                {step.status === 'unverified' && (
                  <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-3xs font-medium text-amber-300">
                    Unverified
                  </span>
                )}
                {step.status === 'unavailable' && (
                  <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-3xs font-medium text-slate-500">
                    Unavailable
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-xs text-slate-400 leading-relaxed max-w-lg">
                {step.description}
              </p>

              {/* Transaction Hash Link */}
              {showLink && (
                <div className="mt-1 flex items-center">
                  <a
                    href={getExplorerUrl(step.txHash!, step.chain!)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-3xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
                  >
                    <span>Tx: {step.txHash!.slice(0, 8)}...{step.txHash!.slice(-6)}</span>
                    <ExternalLink className="h-3 w-3 opacity-60" />
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
