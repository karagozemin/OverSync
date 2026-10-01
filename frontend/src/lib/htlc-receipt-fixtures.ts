/**
 * Shared HTLC receipt fixtures (issue #274).
 *
 * These fixtures are encoded with viem's real event ABI encoding so the
 * receipt parser tests and the timeline component tests exercise the
 * exact byte layout the on-chain contracts emit. Import them wherever an
 * `OrderCreated` / `OrderClaimed` receipt is needed — do not hand-roll
 * log objects in tests.
 *
 * No wallet connection is required to use these: they are plain data.
 */

import {
  encodeAbiParameters,
  encodeEventTopics,
  type AbiEvent,
  type Hex,
} from "viem";
import { createHash } from "node:crypto";

// Lowercase (viem requires checksum-valid addresses when encoding; the
// fixtures below encode sender/beneficiary/claimer as lowercase).
export const V2_ESCROW_ADDRESS = "0xb352339beb146f2699d28d736700b953988bb178" as const;
export const V1_MAINNET_HTLC_ADDRESS = "0x7d9ce70aa40e144e8bbe266a0dc3b3f91b6d1d99" as const;

/** Native ETH token sentinel — the zero address. */
export const NATIVE_ETH = "0x0000000000000000000000000000000000000000" as const;

/** sha256(preimage) — the hashlock format used by both chains' HTLCs. */
export function sha256Hex(value: Hex): `0x${string}` {
  return `0x${createHash("sha256").update(value.slice(2), "hex").digest("hex")}` as `0x${string}`;
}

export const ORDER_PREIMAGE: Hex =
  "0x9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** hashlock the matching order/receipt agree on. */
export const ORDER_HASHLOCK: Hex = sha256Hex(ORDER_PREIMAGE);

/** A different hashlock — used to prove a foreign swap cannot claim. */
export const OTHER_PREIMAGE: Hex =
  "0x2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae";

export const OTHER_HASHLOCK: Hex = sha256Hex(OTHER_PREIMAGE);

/** v2 on-chain order id (uint256 as decimal string). */
export const V2_ORDER_ID = "42";
/** A different v2 order id — the "receipt for another swap" case. */
export const V2_OTHER_ORDER_ID = "43";

/** v1 on-chain order id (bytes32 hex). */
export const V1_ORDER_ID: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
export const V1_OTHER_ORDER_ID: Hex =
  "0x2222222222222222222222222222222222222222222222222222222222222222";

export const LOCK_AMOUNT_WEI = "1000000000000000000"; // 1 ETH
export const OTHER_AMOUNT_WEI = "2000000000000000000"; // 2 ETH

export const LOCK_TX_HASH: Hex =
  "0xaaaa111111111111111111111111111111111111111111111111111111111111";
export const CLAIM_TX_HASH: Hex =
  "0xbbbb222222222222222222222222222222222222222222222222222222222222";

const V2_ORDER_CREATED_ABI = [
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

const V1_ORDER_CREATED_ABI = [
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

const V2_CLAIMED_ABI = [
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

const V1_CLAIMED_ABI = [
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

export interface EncodedLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: number;
}

function encodeLog(
  contractAddress: string,
  abiEvent: AbiEvent,
  args: Record<string, unknown>,
  txHash: Hex
): EncodedLog {
  // viem 2.x has no single `encodeEventLog` export, so topics and data
  // are encoded separately with the same primitives decodeEventLog uses.
  const topics = encodeEventTopics({
    abi: [abiEvent],
    eventName: abiEvent.name,
    args: args as never,
  });
  const nonIndexed = abiEvent.inputs.filter(
    (input): input is (typeof abiEvent.inputs)[number] & { name: string } =>
      !input.indexed && typeof input.name === "string"
  );
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((input) => args[input.name]) as never
  );
  return {
    address: contractAddress,
    topics: topics as string[],
    data,
    transactionHash: txHash,
    blockNumber: 1,
  };
}

// ─── v2 (HTLCEscrow) fixtures ────────────────────────────────────────────────

/** A well-formed v2 lock receipt whose fields match the canonical order. */
export function v2OrderCreatedLog(overrides: {
  orderId?: string;
  hashlock?: Hex;
  amountWei?: string;
} = {}): EncodedLog {
  return encodeLog(
    V2_ESCROW_ADDRESS,
    V2_ORDER_CREATED_ABI[0],
    {
      orderId: BigInt(overrides.orderId ?? V2_ORDER_ID),
      sender: V1_MAINNET_HTLC_ADDRESS,
      beneficiary: V1_MAINNET_HTLC_ADDRESS,
      token: NATIVE_ETH,
      amount: BigInt(overrides.amountWei ?? LOCK_AMOUNT_WEI),
      safetyDeposit: 0n,
      hashlock: overrides.hashlock ?? ORDER_HASHLOCK,
      timelock: 1_700_000_000n,
    },
    LOCK_TX_HASH
  );
}

/** The matching v2 claim log, revealing ORDER_PREIMAGE. */
export function v2OrderClaimedLog(overrides: {
  orderId?: string;
  preimage?: Hex;
} = {}): EncodedLog {
  return encodeLog(
    V2_ESCROW_ADDRESS,
    V2_CLAIMED_ABI[0],
    {
      orderId: BigInt(overrides.orderId ?? V2_ORDER_ID),
      claimer: V1_MAINNET_HTLC_ADDRESS,
      preimage: overrides.preimage ?? ORDER_PREIMAGE,
      amount: BigInt(LOCK_AMOUNT_WEI),
      safetyDeposit: 0n,
    },
    CLAIM_TX_HASH
  );
}

// ─── v1 (MainnetHTLC) fixtures ───────────────────────────────────────────────

export function v1OrderCreatedLog(overrides: {
  orderId?: Hex;
  hashlock?: Hex;
  amountWei?: string;
} = {}): EncodedLog {
  return encodeLog(
    V1_MAINNET_HTLC_ADDRESS,
    V1_ORDER_CREATED_ABI[0],
    {
      orderId: overrides.orderId ?? V1_ORDER_ID,
      sender: V2_ESCROW_ADDRESS,
      beneficiary: V2_ESCROW_ADDRESS,
      token: NATIVE_ETH,
      amount: BigInt(overrides.amountWei ?? LOCK_AMOUNT_WEI),
      hashLock: overrides.hashlock ?? ORDER_HASHLOCK,
      timelock: 1_700_000_000n,
    },
    LOCK_TX_HASH
  );
}

export function v1OrderClaimedLog(overrides: {
  orderId?: Hex;
  preimage?: Hex;
} = {}): EncodedLog {
  return encodeLog(
    V1_MAINNET_HTLC_ADDRESS,
    V1_CLAIMED_ABI[0],
    {
      orderId: overrides.orderId ?? V1_ORDER_ID,
      claimer: V2_ESCROW_ADDRESS,
      secret: overrides.preimage ?? ORDER_PREIMAGE,
    },
    CLAIM_TX_HASH
  );
}

// ─── Receipt shape helpers ───────────────────────────────────────────────────

export function receiptFromLogs(logs: EncodedLog[]): { logs: EncodedLog[] } {
  return { logs };
}

/**
 * A truncated log: topics cut off mid-word. Real RPC nodes can return
 * this shape when a response is interrupted; the parser must treat it as
 * "not a receipt we can trust" instead of throwing.
 */
export function truncatedLog(): EncodedLog {
  return {
    address: V2_ESCROW_ADDRESS,
    topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3"],
    data: "0x",
    transactionHash: LOCK_TX_HASH,
    blockNumber: 1,
  };
}

/** A valid ERC-20 Transfer log — a receipt that is *not* an HTLC receipt. */
export function unrelatedTransferLog(): EncodedLog {
  return {
    address: V2_ESCROW_ADDRESS,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      "0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045",
      "0x000000000000000000000000b352339beb146f2699d28d736700b953988bb178",
    ],
    data: "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    transactionHash: LOCK_TX_HASH,
    blockNumber: 1,
  };
}
