import { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle, XCircle, ArrowRight, ExternalLink, RefreshCw, Undo2, FileText } from 'lucide-react';
import { isTestnet } from '../config/networks';
import RefundDialog from '../features/refund/RefundDialog';
import CopyableIdentifier from './CopyableIdentifier';
import OrderStaleBanner from './OrderStaleBanner';
import HtlcReceiptCard from './HtlcReceiptCard';
import { classifyOrderFreshness } from '../lib/orderFreshness';
import { buildHtlcReceipt } from '../lib/parseHtlcReceipt';
import type { Address } from 'viem';
import HtlcTimeline from './HtlcTimeline';
import {
  fetchCoordinatorOrders,
  isRealHash,
  isRealTransaction,
  mergeTransactions,
  type Transaction,
} from '../lib/orderRecovery';

interface TransactionHistoryProps {
  ethAddress?: string;
  stellarAddress?: string;
}

const STORAGE_KEY = 'oversync_transactions_v2';
const PRODUCTION_API_BASE_URL = 'https://oversync-k36vx.ondigitalocean.app';
const API_BASE_URL = import.meta.env.PROD
  ? ''
  : (import.meta as any).env?.VITE_API_BASE_URL || PRODUCTION_API_BASE_URL;

const isTestnetTx = (tx: Transaction): boolean => {
  return tx.networkMode === 'testnet' || (tx.networkMode === undefined && isTestnet());
};

export default function TransactionHistory({ ethAddress, stellarAddress }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed' | 'cancelled'>('all');
  const [refundTarget, setRefundTarget] = useState<Transaction | null>(null);
  const [manualRefundingIds, setManualRefundingIds] = useState<Set<string>>(() => new Set());
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  const [receiptOpenIds, setReceiptOpenIds] = useState<Set<string>>(() => new Set());

  const isTxExpanded = (tx: Transaction): boolean => {
    if (expandedTxIds.has(tx.id + '_hidden')) {
      return false;
    }
    if (expandedTxIds.has(tx.id)) {
      return true;
    }
    return isTestnetTx(tx) && tx.status === 'pending';
  };

  const toggleExpandTx = (id: string, isDefaultExpanded: boolean) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (isDefaultExpanded) {
        if (next.has(id + '_hidden')) {
          next.delete(id + '_hidden');
        } else {
          next.add(id + '_hidden');
        }
      } else {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  };

  const loadFromStorage = useCallback((): Transaction[] => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Transaction[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRealTransaction);
    } catch (err) {
      console.warn('Could not parse stored transactions:', err);
      return [];
    }
  }, []);

  const refreshFromCoordinator = useCallback(async () => {
    const local = loadFromStorage();
    if (!ethAddress && !stellarAddress) {
      setTransactions(local);
      return;
    }
    setIsLoading(true);
    try {
      const remote = await fetchCoordinatorOrders(API_BASE_URL, { ethAddress, stellarAddress });
      const merged = mergeTransactions(local, remote);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      setTransactions(merged);
    } catch (err) {
      console.warn('Coordinator history unavailable, falling back to local cache:', err);
      setTransactions(local);
    } finally {
      setIsLoading(false);
    }
  }, [ethAddress, stellarAddress, loadFromStorage]);

  useEffect(() => {
    setTransactions(loadFromStorage());
    void refreshFromCoordinator();
  }, [loadFromStorage, refreshFromCoordinator]);

  const getStatusColor = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return 'text-green-400 bg-green-500/20';
      case 'pending':
        return 'text-yellow-400 bg-yellow-500/20';
      case 'cancelled':
        return 'text-gray-400 bg-gray-500/20';
      case 'failed':
        return 'text-red-400 bg-red-500/20';
      default:
        return 'text-gray-400 bg-gray-500/20';
    }
  };

  const getStatusIcon = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4" />;
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4" />;
      case 'failed':
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const formatTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  };

  const filteredTransactions = transactions.filter(tx =>
    filter === 'all' || tx.status === filter
  );

  const getEtherscanUrl = (txHash: string): string => {
    const base = isTestnet() ? 'https://sepolia.etherscan.io' : 'https://etherscan.io';
    return `${base}/tx/${txHash}`;
  };

  const getStellarExplorerUrl = (txHash: string): string => {
    const network = isTestnet() ? 'testnet' : 'public';
    return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  };

  /**
   * Pick the right block explorer for a refund tx.
   *
   * `refundNetwork` is the authoritative signal once we start writing it.
   * For legacy entries that don't have it, we fall back to a hash-shape
   * heuristic: Ethereum hashes are 0x-prefixed, Stellar hashes are not.
   */
  const getRefundNetwork = (tx: Transaction): 'ethereum' | 'stellar' => {
    if (tx.refundNetwork) return tx.refundNetwork;
    if (tx.refundTxHash?.startsWith('0x')) return 'ethereum';
    return 'stellar';
  };

  const getRefundExplorerUrl = (tx: Transaction): string => {
    if (!tx.refundTxHash) return '#';
    return getRefundNetwork(tx) === 'ethereum'
      ? getEtherscanUrl(tx.refundTxHash)
      : getStellarExplorerUrl(tx.refundTxHash);
  };

  const getRefundNetworkLabel = (tx: Transaction): string =>
    getRefundNetwork(tx) === 'ethereum' ? 'Ethereum' : 'Stellar';

  const toggleReceipt = (id: string) => {
    setReceiptOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * A pending ETH→XLM swap is "refundable" once we have all three on-chain
   * coordinates and the order is still in pending/failed state. We do NOT
   * gate on time here — RefundDialog itself enforces the timelock and only
   * unlocks the button after it expires.
   */
  const canRefund = (tx: Transaction): boolean => {
    return (
      tx.direction === 'eth-to-xlm' &&
      (tx.status === 'pending' || tx.status === 'failed') &&
      !tx.refundedAt &&
      !!tx.onChainOrderId &&
      !!tx.htlcContractAddress &&
      !!tx.timelockUnixSeconds
    );
  };

  const canManualRefundXlm = (tx: Transaction): boolean => {
    return (
      tx.direction === 'xlm-to-eth' &&
      tx.status === 'failed' &&
      tx.autoRefundFailed === true &&
      !tx.refundedAt &&
      !!(tx.stellarTxHash || tx.txHash) &&
      !!(tx.stellarAddress || stellarAddress)
    );
  };

  const markRefunded = (
    orderId: string,
    refundHash: string,
    refundNetwork: 'ethereum' | 'stellar'
  ) => {
    setTransactions((prev) => {
      const next = prev.map((tx) =>
        tx.id === orderId
          ? {
              ...tx,
              status: 'cancelled' as const,
              refundTxHash: refundHash,
              refundNetwork,
              refundedAt: Date.now(),
            }
          : tx
      );
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleManualXlmRefund = async (tx: Transaction) => {
    const originalStellarTx = tx.stellarTxHash || tx.txHash;
    const refundAddress = tx.stellarAddress || stellarAddress;

    if (!originalStellarTx || !refundAddress) {
      window.alert('Manual refund requires the original Stellar transaction and your Stellar wallet address.');
      return;
    }

    setManualRefundingIds((prev) => new Set(prev).add(tx.id));
    try {
      const res = await fetch(`${API_BASE_URL}/api/orders/manual-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stellarTxHash: originalStellarTx,
          stellarAddress: refundAddress,
          networkMode: tx.networkMode || (isTestnet() ? 'testnet' : 'mainnet'),
        }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.details || body?.error || `Refund failed with ${res.status}`);
      }

      if (!body?.refundTxHash) {
        throw new Error('Refund response did not include a transaction hash.');
      }

      markRefunded(tx.id, body.refundTxHash, 'stellar');
      window.alert(`XLM refund submitted.\nRefund TX: ${body.refundTxHash}`);
    } catch (err) {
      window.alert(`Manual XLM refund failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setManualRefundingIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
    }
  };

  const handleRefunded = (orderId: string, refundHash: `0x${string}`) => {
    markRefunded(orderId, refundHash, 'ethereum');
    setRefundTarget(null);
  };

  return (
    <div className="surface-panel flex max-h-[calc(100dvh-21rem)] min-h-[28rem] flex-col overflow-hidden rounded-[1.25rem] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.36)] md:p-6 lg:max-h-[calc(100dvh-18rem)]">
      <div className="mb-6 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/55">Ledger</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Transaction History</h2>
          <p className="mt-2 text-sm text-slate-400">
            Track your cross-chain swaps between Ethereum and Stellar networks
          </p>
        </div>
        <button
          onClick={refreshFromCoordinator}
          disabled={isLoading}
          className="button-hover-scale flex items-center justify-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-200/[0.12] px-4 py-2 text-sm font-semibold text-cyan-50 shadow-[0_12px_34px_rgba(0,226,255,0.12)] transition hover:border-cyan-100/45 hover:bg-cyan-200/[0.18] disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="mb-4 flex shrink-0 gap-2 overflow-x-auto pb-1">
        {[
          { key: 'all', label: 'All' },
          { key: 'pending', label: 'Pending' },
          { key: 'completed', label: 'Completed' },
          { key: 'cancelled', label: 'Cancelled' }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key as any)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              filter === key
                ? 'brand-cta'
                : 'border border-white/10 bg-white/[0.045] text-slate-400 hover:bg-white/[0.075] hover:text-white'
            }`}
          >
            {label} {key !== 'all' && `(${transactions.filter(tx => tx.status === key).length})`}
          </button>
        ))}
      </div>

      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
        {filteredTransactions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045]">
              <Clock className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-lg text-slate-300">No transactions yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Your real cross-chain swaps will appear here after the first transaction
            </p>
          </div>
        ) : (
          filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="rounded-2xl border border-white/10 bg-white/[0.045] p-4 transition hover:border-cyan-200/20 hover:bg-white/[0.065]"
            >
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(tx.status)}`}>
                    {getStatusIcon(tx.status)}
                    <span className="capitalize">{tx.status}</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {formatTime(tx.timestamp)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {tx.ethTxHash && isRealHash(tx.ethTxHash) && (
                    <div className="flex items-center gap-1">
                      <a
                        href={getEtherscanUrl(tx.ethTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                        title="View on Etherscan"
                      >
                        <img src="/images/eth.png" alt="ETH" className="h-3.5 w-3.5" />
                        <span>Etherscan</span>
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </a>
                      <CopyableIdentifier
                        value={getEtherscanUrl(tx.ethTxHash)}
                        hideDisplay
                        copyLabel="Etherscan URL"
                      />
                    </div>
                  )}
                  {tx.stellarTxHash && isRealHash(tx.stellarTxHash) && (
                    <div className="flex items-center gap-1">
                      <a
                        href={getStellarExplorerUrl(tx.stellarTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                        title="View on Stellar Expert"
                      >
                        <img src="/images/xlm.png" alt="XLM" className="h-3.5 w-3.5" />
                        <span>Stellar Expert</span>
                        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                      </a>
                      <CopyableIdentifier
                        value={getStellarExplorerUrl(tx.stellarTxHash)}
                        hideDisplay
                        copyLabel="Stellar Expert URL"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-center">
                    <div className="text-white font-medium">
                      {tx.amount} {tx.fromToken}
                    </div>
                    <div className="text-xs text-slate-400">
                      {tx.fromNetwork}
                    </div>
                  </div>

                  <ArrowRight className="h-4 w-4 text-slate-400" />

                  <div className="rounded-xl border border-white/10 bg-black/10 p-3 text-center">
                    <div className="text-white font-medium">
                      {tx.estimatedAmount} {tx.toToken}
                    </div>
                    <div className="text-xs text-slate-400">
                      {tx.toNetwork}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                <div className="flex min-w-0 items-center gap-1 text-xs text-slate-400">
                  <span>Transaction:</span>
                  <CopyableIdentifier
                    value={tx.txHash}
                    truncate
                    copyLabel="transaction hash"
                    textClassName="text-slate-300"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {isTestnetTx(tx) && (
                    <button
                      onClick={() => toggleExpandTx(tx.id, tx.status === 'pending')}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isTxExpanded(tx)
                          ? 'border-cyan-300 bg-cyan-500/20 text-cyan-200'
                          : 'border-white/10 bg-white/[0.045] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      <span>{isTxExpanded(tx) ? 'Hide Timeline' : 'Show Timeline'}</span>
                    </button>
                  )}
                  {(tx.status === 'completed' || tx.status === 'cancelled' || tx.status === 'failed') && (
                    <button
                      onClick={() => toggleReceipt(tx.id)}
                      className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                      title="View HTLC settlement receipt"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {receiptOpenIds.has(tx.id) ? 'Hide Receipt' : 'Receipt'}
                    </button>
                  )}
                  {tx.refundTxHash && (
                    <div className="flex items-center gap-1">
                      <a
                        href={getRefundExplorerUrl(tx)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                        title={`Refund settled on ${getRefundNetworkLabel(tx)}. Click to view the refund transaction.`}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        <span>Refunded · view on</span>
                        <img
                          src={getRefundNetwork(tx) === 'ethereum' ? '/images/eth.png' : '/images/xlm.png'}
                          alt={getRefundNetworkLabel(tx)}
                          className="h-3.5 w-3.5"
                        />
                        <span>{getRefundNetworkLabel(tx)}</span>
                      </a>
                      <CopyableIdentifier
                        value={getRefundExplorerUrl(tx)}
                        hideDisplay
                        copyLabel="refund URL"
                      />
                    </div>
                  )}
                  {canRefund(tx) && (
                    <button
                      onClick={() => setRefundTarget(tx)}
                      className="flex items-center gap-1.5 rounded-full border border-indigo-300/30 bg-indigo-400/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-400/25"
                      title="Refund your locked ETH from the HTLC contract once the timelock expires"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Refund ETH
                    </button>
                  )}
                  {canManualRefundXlm(tx) && (
                    <button
                      onClick={() => void handleManualXlmRefund(tx)}
                      disabled={manualRefundingIds.has(tx.id)}
                      className="flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Ask the relayer to refund your original XLM payment"
                    >
                      <Undo2 className={`h-3.5 w-3.5 ${manualRefundingIds.has(tx.id) ? 'animate-spin' : ''}`} />
                      {manualRefundingIds.has(tx.id) ? 'Refunding...' : 'Refund XLM'}
                    </button>
                  )}
                </div>
              </div>

              <OrderStaleBanner
                freshness={classifyOrderFreshness({
                  status: tx.status,
                  updatedAt: tx.timestamp,
                  nowMs: Date.now(),
                  timelockUnixSeconds: tx.timelockUnixSeconds,
                })}
              />

              {isTestnetTx(tx) && isTxExpanded(tx) && (
                <HtlcTimeline tx={tx} />
              )}
              {receiptOpenIds.has(tx.id) && (
                <HtlcReceiptCard
                  receipt={buildHtlcReceipt({
                    orderId: tx.onChainOrderId || tx.id,
                    direction: tx.direction,
                    amount: tx.amount,
                    fromToken: tx.fromToken,
                    toToken: tx.toToken,
                    estimatedAmount: tx.estimatedAmount,
                    status: tx.status,
                    ethTxHash: tx.ethTxHash,
                    stellarTxHash: tx.stellarTxHash,
                    refundTxHash: tx.refundTxHash,
                    refundNetwork: tx.refundNetwork,
                    timelockUnixSeconds: tx.timelockUnixSeconds,
                  })}
                />
              )}
            </div>
          ))
        )}
      </div>

      {refundTarget && refundTarget.onChainOrderId && refundTarget.htlcContractAddress && refundTarget.timelockUnixSeconds && ethAddress && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <RefundDialog
            userAddress={ethAddress as Address}
            orderId={refundTarget.onChainOrderId}
            timelockUnixSeconds={refundTarget.timelockUnixSeconds}
            amountWei={refundTarget.amountWei ?? '0'}
            contractMode={refundTarget.htlcContractMode ?? 'v1-mainnet-htlc'}
            v1ContractAddress={refundTarget.htlcContractAddress as Address}
            onClose={() => setRefundTarget(null)}
            onRefunded={(hash) => handleRefunded(refundTarget.id, hash)}
          />
        </div>
      )}
    </div>
  );
}