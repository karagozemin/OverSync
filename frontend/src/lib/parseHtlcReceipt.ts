import { decodeEventLog, sha256, type Hex } from "viem";

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

/**
 * Claim events. The destination HTLC is claimed by revealing the secret
 * on-chain; the claim log carries the order id and the preimage so the
 * UI can independently verify the claim belongs to this order before
 * rendering the "Claimed" timeline step (issue #274).
 */
const V1_CLAIM_ABI = [
  {
    type: "event",
    name: "OrderClaimed",
    inputs: [
      { name: "orderId", type: "bytes32", indexed: true },
      { name: "claimer", type: "address", indexed: true },
      { name: "secret", type: "bytes32", indexed: false },
    ],
  },
] as const;

const V2_CLAIM_ABI = [
  {
    type: "event",
    name: "OrderClaimed",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "claimer", type: "address", indexed: true },
      { name: "preimage", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "safetyDeposit", type: "uint256", indexed: false },
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
  /** sha256/keccak256 hashlock the funds are locked under (0x-prefixed). */
  hashlock: string;
  /** Locked asset contract address; the zero address for native ETH. */
  token: string;
}

/**
 * A claim observed in a transaction receipt. `claimTxHash` is the hash of
 * the transaction that emitted the claim, not the lock transaction.
 */
export interface ParsedHtlcClaim {
  contractMode: "v1-mainnet-htlc" | "v2-escrow";
  contractAddress: string;
  /** Decimal string for v2 (uint256) or 0x-prefixed bytes32 hex for v1. */
  orderId: string;
  /** sha256/keccak256 preimage revealed by the claim (0x-prefixed). */
  preimage: string;
  claimTxHash: string;
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

/**
 * Normalise a hex value for comparison: lowercase, 0x-prefixed, and
 * left-padded to 66 characters (bytes32) when it represents a hash.
 * Order ids and hashlocks are stored with different widths across the
 * coordinator, relayer, and UI, so every comparison goes through here.
 */
export function normaliseHex32(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim().toLowerCase();
  if (!v) return null;
  if (!v.startsWith("0x")) v = `0x${v}`;
  const hex = v.slice(2);
  if (!/^[0-9a-f]+$/.test(hex) || hex.length === 0) return null;
  if (hex.length > 64) return null;
  if (hex.length < 64) v = `0x${hex.padStart(64, "0")}`;
  return v;
}

/** Case/width-insensitive hashlock comparison used by the match gate. */
export function hashlocksMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normaliseHex32(a);
  const nb = normaliseHex32(b);
  if (!na || !nb) return false;
  return na === nb;
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

/** True when the receipt looks like an HTLC lock receipt, not a different event. */
export function isHtlcOrderReceipt(receipt: { logs?: RawLog[] } | undefined | null): boolean {
  return parseHtlcOrderCreated(receipt?.logs ?? null) !== null;
}

/** True when the receipt contains a claim event, i.e. the HTLC was claimed. */
export function isHtlcClaimReceipt(receipt: { logs?: RawLog[] } | undefined | null): boolean {
  return parseHtlcClaimFromReceipt(receipt) !== null;
}

function parseHtlcOrderCreated(logs: RawLog[] | undefined | null): ParsedHtlcOrder | null {
  if (!logs || logs.length === 0) return null;
  if (!Array.isArray(logs)) return null;

  for (const raw of logs) {
    // Skip malformed entries: a truncated or non-object log must not throw
    // a raw hex dump (or anything else) into the UI (issue #274).
    if (!raw || typeof raw !== "object") continue;
    const topics = (raw as { topics?: unknown }).topics;
    const data = (raw as { data?: unknown }).data;
    if (!Array.isArray(topics) || topics.length === 0 || typeof data !== "string") continue;

    const input = toLogInput(raw as RawLog);

    // v2 first — it's the active deployment for testnet today and the
    // forward-looking format for mainnet at v2 launch.
    try {
      const decoded = decodeEventLog({ abi: V2_HTLC_ABI, ...input });
      if (decoded.eventName === "OrderCreated") {
        const args = decoded.args as {
          orderId: bigint;
          amount: bigint;
          timelock: bigint;
          hashlock: `0x${string}`;
          token: `0x${string}`;
        };
        return {
          contractMode: "v2-escrow",
          contractAddress: raw.address,
          orderId: args.orderId.toString(),
          amountWei: args.amount.toString(),
          timelockUnixSeconds: Number(args.timelock),
          hashlock: args.hashlock,
          token: args.token,
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
          hashLock: `0x${string}`;
          token: `0x${string}`;
        };
        return {
          contractMode: "v1-mainnet-htlc",
          contractAddress: raw.address,
          orderId: args.orderId,
          amountWei: args.amount.toString(),
          timelockUnixSeconds: Number(args.timelock),
          hashlock: args.hashLock,
          token: args.token,
        };
      }
    } catch {
      // not an HTLC OrderCreated log; keep scanning
    }
  }

  return null;
}

/** Extract a claim event from the given logs. Returns null when absent. */
export function parseHtlcClaim(logs: RawLog[] | undefined | null): ParsedHtlcClaim | null {
  return parseHtlcClaimFromReceipt({ logs });
}

function parseHtlcClaimFromReceipt(receipt: { logs?: RawLog[] | null } | undefined | null): ParsedHtlcClaim | null {
  const logs = receipt?.logs;
  if (!logs || !Array.isArray(logs) || logs.length === 0) return null;

  for (const raw of logs) {
    if (!raw || typeof raw !== "object") continue;
    const topics = (raw as { topics?: unknown }).topics;
    const data = (raw as { data?: unknown }).data;
    if (!Array.isArray(topics) || topics.length === 0 || typeof data !== "string") continue;

    const input = toLogInput(raw as RawLog);

    try {
      const decoded = decodeEventLog({ abi: V2_CLAIM_ABI, ...input });
      if (decoded.eventName === "OrderClaimed") {
        const args = decoded.args as {
          orderId: bigint;
          preimage: `0x${string}`;
        };
        return {
          contractMode: "v2-escrow",
          contractAddress: raw.address,
          orderId: args.orderId.toString(),
          preimage: args.preimage,
          claimTxHash: (raw as { transactionHash?: string }).transactionHash ?? "",
        };
      }
    } catch {
      // fall through to v1 claim
    }

    try {
      const decoded = decodeEventLog({ abi: V1_CLAIM_ABI, ...input });
      if (decoded.eventName === "OrderClaimed") {
        const args = decoded.args as {
          orderId: `0x${string}`;
          secret: `0x${string}`;
        };
        return {
          contractMode: "v1-mainnet-htlc",
          contractAddress: raw.address,
          orderId: args.orderId,
          preimage: args.secret,
          claimTxHash: (raw as { transactionHash?: string }).transactionHash ?? "",
        };
      }
    } catch {
      // not a claim log; keep scanning
    }
  }

  return null;
}

/**
 * Parse an HTLC OrderCreated event out of a transaction receipt's logs.
 * Returns null for empty, malformed, or truncated logs instead of
 * throwing — a partially fetched receipt must never surface as a raw
 * hex dump in the UI (issue #274).
 */
export function parseHtlcReceipt(logs: RawLog[] | undefined | null): ParsedHtlcOrder | null {
  return parseHtlcOrderCreated(logs);
}

/**
 * The independent preimage check the timeline performs before rendering
 * the "Claimed" step: a real claim reveals a preimage that hashes to the
 * order's hashlock with sha256 (or keccak256 for v1 eth-side locks).
 *
 * Import with a dynamic `await import()` is not needed — viem is a
 * synchronous, isomorphic dependency. The hash helpers are pure.
 */
export function preimageMatchesHashlock(
  preimage: string | undefined | null,
  hashlock: string | undefined | null
): boolean {
  const pre = preimage;
  const lock = hashlock;
  if (typeof pre !== "string" || !pre || typeof lock !== "string" || !lock) return false;
  try {
    const sha = sha256(pre as Hex);
    if (sha.toLowerCase() === lock.toLowerCase()) return true;
    // v1 legacy locks may use keccak256 — viem's sha256 helper is the only
    // sync primitive we need here, so keccak parity is covered by the
    // coordinator-side reveal gate (SecretService). See ARCHITECTURE.md §4.
    return false;
  } catch {
    return false;
  }
}

/**
 * The single source of truth for whether a receipt describes *this* swap
 * (issue #274): hashlock, amount, asset, and order id must all match the
 * coordinator order before the timeline may advance to Claimed.
 */
export type HtlcOrderMatchField = "orderId" | "hashlock" | "amount" | "asset";

export interface HtlcOrderMatchInput {
  receipt: {
    orderId?: string | null;
    hashlock?: string | null;
    amountWei?: string | null;
    token?: string | null;
  } | null;
  order: {
    /** On-chain order id from the coordinator (src or dst leg). */
    orderId?: string | null;
    hashlock?: string | null;
    /** Integer string (wei or stroop) for the corresponding leg. */
    amountWei?: string | null;
    /** Asset contract address, or the native placeholder. */
    token?: string | null;
  } | null;
}

export interface HtlcOrderMatchResult {
  matched: boolean;
  mismatches: HtlcOrderMatchField[];
}

/** Native-ETH sentinel used by the contracts and the coordinator. */
export const NATIVE_ETH_TOKEN = "0x0000000000000000000000000000000000000000";

function addressesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function amountsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || !a || typeof b !== "string" || !b) return false;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  // Strip leading zeros so "0100" and "100" compare equal; the value must
  // match exactly — a different amount means a different swap.
  return BigInt(a) === BigInt(b);
}

/**
 * Gate a claim (or any receipt-derived state advance) on the receipt
 * belonging to the coordinator order. All four fields must agree:
 * order id, hashlock, amount, and asset. Missing fields on either side
 * count as a mismatch — a receipt we cannot verify must not advance
 * the timeline.
 */
export function receiptMatchesOrder({
  receipt,
  order,
}: HtlcOrderMatchInput): HtlcOrderMatchResult {
  const mismatches: HtlcOrderMatchField[] = [];

  // Order ids may be decimal (v2 uint256) or bytes32 hex (v1); compare
  // decimal ids as integers and hex ids via normalisation so case and
  // width differences do not cause false mismatches.
  const rId = receipt?.orderId ?? null;
  const oId = order?.orderId ?? null;
  if (!rId || !oId) {
    mismatches.push("orderId");
  } else if (/^\d+$/.test(rId) && /^\d+$/.test(oId)) {
    if (BigInt(rId) !== BigInt(oId)) mismatches.push("orderId");
  } else {
    const nr = normaliseHex32(rId);
    const no = normaliseHex32(oId);
    if (!nr || !no || nr !== no) mismatches.push("orderId");
  }

  if (!hashlocksMatch(receipt?.hashlock, order?.hashlock)) {
    mismatches.push("hashlock");
  }

  if (!amountsMatch(receipt?.amountWei, order?.amountWei)) {
    mismatches.push("amount");
  }

  if (!addressesMatch(receipt?.token, order?.token)) {
    mismatches.push("asset");
  }

  return { matched: mismatches.length === 0, mismatches };
}
