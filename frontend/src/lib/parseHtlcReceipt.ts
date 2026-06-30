import { decodeEventLog, type Hex } from "viem";

/**
 * ABI fragments for the two HTLC versions OverSync currently supports.
 *
 * v1 `MainnetHTLC.OrderCreated` keys the order by a bytes32 hash, while
 * v2 `HTLCEscrow.OrderCreated` uses a monotonic uint256 id. We try both
 * decodes so a single helper works regardless of which contract the
 * relayer happens to deploy ETH into.
 */
const V1_HTLC_ABI = [
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "hashLock", type: "bytes32", indexed: false },
      { name: "timelock", type: "uint256", indexed: false },
    ],
  },
] as const;

const V2_HTLC_ABI = [
  {
    type: "event",
    name: "OrderCreated",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "beneficiary", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "safetyDeposit", type: "uint256", indexed: false },
      { name: "hashlock", type: "bytes32", indexed: false },
      { name: "timelock", type: "uint64", indexed: false },
    ],
  },
] as const;

export interface ParsedHtlcOrder {
  contractMode: "v1-mainnet-htlc" | "v2-escrow";
  contractAddress: string;
  /** Decimal string for v2 (uint256) or 0x-prefixed bytes32 hex for v1. */
  orderId: string;
  amountWei: string;
  timelockUnixSeconds: number;
}

interface RawLog {
  address: string;
  topics: string[];
  data: string;
}

function toLogInput(log: RawLog) {
  return {
    address: log.address as `0x${string}`,
    topics: log.topics as [Hex, ...Hex[]],
    data: log.data as Hex,
  };
}

// ─── Read-only receipt data for completed/refunded swaps ──────────────────────

export interface ReceiptExplorerLink {
  label: string;
  url: string;
  hash: string;
}

export interface HtlcReceiptData {
  orderId: string;
  sourceChain: string;
  destinationChain: string;
  lockTx: ReceiptExplorerLink;
  claimTx: ReceiptExplorerLink | null;
  refundTx: ReceiptExplorerLink | null;
  finalState: 'completed' | 'refunded' | 'failed';
  timelockSummary: string;
  nonCustodialExplanation: string;
  direction: 'eth-to-xlm' | 'xlm-to-eth';
  amount: string;
  fromToken: string;
  toToken: string;
  estimatedAmount: string;
}

const ETHERSCAN_BASE = 'https://sepolia.etherscan.io';
const STELLAR_EXPLORER_BASE = 'https://stellar.expert/explorer/testnet';

function receiptLink(hash: string, chain: 'ethereum' | 'stellar'): { url: string; label: string } {
  if (chain === 'ethereum') {
    return { url: `${ETHERSCAN_BASE}/tx/${hash}`, label: 'Etherscan' };
  }
  return { url: `${STELLAR_EXPLORER_BASE}/tx/${hash}`, label: 'Stellar Expert' };
}

export function buildHtlcReceipt(params: {
  orderId: string;
  direction: 'eth-to-xlm' | 'xlm-to-eth';
  amount: string;
  fromToken: string;
  toToken: string;
  estimatedAmount: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  ethTxHash?: string;
  stellarTxHash?: string;
  refundTxHash?: string;
  refundNetwork?: 'ethereum' | 'stellar';
  timelockUnixSeconds?: number;
}): HtlcReceiptData {
  const isEthToXlm = params.direction === 'eth-to-xlm';
  const sourceChain = isEthToXlm ? 'Ethereum Sepolia' : 'Stellar Testnet';
  const destChain = isEthToXlm ? 'Stellar Testnet' : 'Ethereum Sepolia';

  const lockHash = isEthToXlm
    ? (params.ethTxHash ?? params.stellarTxHash ?? '')
    : (params.stellarTxHash ?? params.ethTxHash ?? '');

  const lockChain: 'ethereum' | 'stellar' = isEthToXlm ? 'ethereum' : 'stellar';

  const claimHash = isEthToXlm
    ? (params.stellarTxHash ?? '')
    : (params.ethTxHash ?? '');

  const finalState: HtlcReceiptData['finalState'] =
    params.status === 'completed' ? 'completed'
    : params.status === 'pending' ? 'failed'
    : params.refundTxHash ? 'refunded'
    : 'failed';

  const refundLink: ReceiptExplorerLink | null =
    params.refundTxHash
      ? (() => {
          const rn = params.refundNetwork ?? (params.refundTxHash.startsWith('0x') ? 'ethereum' : 'stellar');
          const link = receiptLink(params.refundTxHash, rn);
          return { label: link.label, url: link.url, hash: params.refundTxHash };
        })()
      : null;

  const timelockSummary = isEthToXlm
    ? `ETH locked under 24h timelock on Ethereum — XLM locked under 12h timelock on Stellar`
    : `XLM locked under 12h timelock on Stellar — ETH locked under 24h timelock on Ethereum`;

  const nonCustodialExplanation =
    `Funds were locked in on-chain HTLC contracts (SHA-256 hashlock + timelock) on both Ethereum and Stellar. ` +
    `No intermediary, relayer, or coordinator ever controlled your assets. ` +
    `Settlement required a SHA-256 preimage reveal; if the swap failed, each leg refunded to your address ` +
    `permissionlessly. There was no state in which your funds were stranded under operator control.`;

  return {
    orderId: params.orderId,
    sourceChain,
    destinationChain: destChain,
    lockTx: {
      hash: lockHash,
      ...receiptLink(lockHash, lockChain),
    },
    claimTx: claimHash
      ? { hash: claimHash, ...receiptLink(claimHash, isEthToXlm ? 'stellar' : 'ethereum') }
      : null,
    refundTx: refundLink,
    finalState,
    timelockSummary,
    nonCustodialExplanation,
    direction: params.direction,
    amount: params.amount,
    fromToken: params.fromToken,
    toToken: params.toToken,
    estimatedAmount: params.estimatedAmount,
  };
}

export function parseHtlcReceipt(logs: RawLog[] | undefined | null): ParsedHtlcOrder | null {
  if (!logs || logs.length === 0) return null;

  for (const raw of logs) {
    if (!raw?.topics?.length || !raw.data) continue;
    const input = toLogInput(raw);

    // v2 first — it's the active deployment for testnet today and the
    // forward-looking format for mainnet at v2 launch.
    try {
      const decoded = decodeEventLog({ abi: V2_HTLC_ABI, ...input });
      if (decoded.eventName === "OrderCreated") {
        const args = decoded.args as {
          orderId: bigint;
          amount: bigint;
          timelock: bigint;
        };
        return {
          contractMode: "v2-escrow",
          contractAddress: raw.address,
          orderId: args.orderId.toString(),
          amountWei: args.amount.toString(),
          timelockUnixSeconds: Number(args.timelock),
        };
      }
    } catch {
      // fall through to v1
    }

    try {
      const decoded = decodeEventLog({ abi: V1_HTLC_ABI, ...input });
      if (decoded.eventName === "OrderCreated") {
        const args = decoded.args as {
          orderId: `0x${string}`;
          amount: bigint;
          timelock: bigint;
        };
        return {
          contractMode: "v1-mainnet-htlc",
          contractAddress: raw.address,
          orderId: args.orderId,
          amountWei: args.amount.toString(),
          timelockUnixSeconds: Number(args.timelock),
        };
      }
    } catch {
      // not an HTLC OrderCreated log; keep scanning
    }
  }

  return null;
}
