import type { Chain, Direction } from "@oversync/sdk/types";
import type { ResolverConfig } from "../config.js";
import type {
  ObservedSourceOrder,
  DestinationOrderParams,
  FillPlan,
  PlanResult
} from "./types.js";
import { validateResolverConfig, validateDestinationParams } from "./validate.js";

/**
 * Plan parameters that modify planner behaviour.
 */
export interface PlanOptions {
  /** Relative timelock buffer in seconds — the destination timelock
   *  will be sourceTimelock - this buffer (subject to min/max bounds). */
  timelockBufferSeconds?: bigint;
  /** Fee deducted from the destination amount, in basis points. */
  feeBasisPoints?: bigint;
  /** Dry-run mode: never requires private keys. */
  dryRun: boolean;
}

const DEFAULT_TIMELOCK_BUFFER = 600n; // 10 minutes
const DEFAULT_FEE_BASIS_POINTS = 10n; // 0.1 %

/**
 * Determine the direction of a cross-chain swap from the source chain.
 */
function resolveDirection(sourceChain: Chain): Direction {
  return sourceChain === "ethereum" ? "eth_to_xlm" : "xlm_to_eth";
}

/**
 * Determine the destination chain from the source chain.
 */
function resolveDestinationChain(sourceChain: Chain): Chain {
  return sourceChain === "ethereum" ? "stellar" : "ethereum";
}

/**
 * Compute the destination-side timelock (relative seconds).
 *
 * The resolver must have a *shorter* timelock on its fill so that the
 * resolver can safely refund its side if the user never reveals the
 * preimage before the source order expires.
 */
function computeTimelockSeconds(
  sourceTimelockAbs: bigint,
  nowSeconds: bigint,
  bufferSeconds: bigint
): bigint {
  const remaining = sourceTimelockAbs - nowSeconds;
  const clamped = remaining - bufferSeconds;
  if (clamped < 300n) return 300n;
  if (clamped > 86400n) return 86400n;
  return clamped;
}

/**
 * Compute the destination amount after deducting the resolver fee.
 */
function computeDestinationAmount(
  sourceAmount: bigint,
  feeBasisPoints: bigint
): bigint {
  if (feeBasisPoints === 0n) return sourceAmount;
  const fee = (sourceAmount * feeBasisPoints) / 10000n;
  return sourceAmount - fee;
}

/**
 * Build a fill plan for a given observed source order.
 *
 * The planner is a pure function — it returns the plan or validation
 * errors. It never submits transactions or touches keys.
 */
export function buildPlan(
  order: ObservedSourceOrder,
  cfg: ResolverConfig,
  opts: PlanOptions
): PlanResult {
  // 1. Validate resolver config.
  const configErrors = validateResolverConfig(cfg, opts.dryRun);
  if (configErrors.length > 0) {
    return { ok: false, errors: configErrors };
  }

  const direction = resolveDirection(order.sourceChain);
  const destinationChain = resolveDestinationChain(order.sourceChain);

  // 2. Compute destination-side parameters.
  const timelockBuffer = opts.timelockBufferSeconds ?? DEFAULT_TIMELOCK_BUFFER;
  const feeBp = opts.feeBasisPoints ?? DEFAULT_FEE_BASIS_POINTS;

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timelockSeconds = computeTimelockSeconds(
    order.timelock,
    nowSeconds,
    timelockBuffer
  );
  const destinationAmount = computeDestinationAmount(order.amount, feeBp);

  // 3. Map addresses for the counterpart leg.
  //
  //    When the user locks funds on the source chain (sender + beneficiary),
  //    the resolver fills the destination chain where:
  //      - beneficiary = the user's address on the destination chain
  //        (in dry-run we use the source beneficiary as a placeholder;
  //         in production the resolver would resolve it via a mapping)
  //      - refundAddress = the resolver's own address on the destination chain
  //        (so expired fills return to the resolver)
  //
  //    For ETH→XLM: beneficiary stays as the source beneficiary (placeholder),
  //    refundAddress uses the resolver's Stellar address (placeholder in dry-run).
  //    For XLM→ETH: same logic, reversed.
  const beneficiary: string = order.beneficiary;
  const refundAddress: string =
    destinationChain === "ethereum"
      ? (cfg.ethereum.resolverRegistry ?? order.sender)
      : (cfg.soroban.resolverRegistry ?? order.sender);

  const destination: DestinationOrderParams = {
    destinationChain,
    beneficiary,
    refundAddress,
    token: order.token,
    amount: destinationAmount,
    safetyDeposit: order.safetyDeposit,
    hashlock: order.hashlock,
    timelockSeconds
  };

  // 4. Validate computed destination params.
  const paramErrors = validateDestinationParams(
    destination.amount,
    destination.safetyDeposit,
    destination.timelockSeconds
  );
  if (paramErrors.length > 0) {
    return { ok: false, errors: paramErrors };
  }

  const plan: FillPlan = {
    source: order,
    destination,
    direction
  };

  return { ok: true, plan };
}

/**
 * Convenience factory: build an ObservedSourceOrder from an
 * Ethereum OrderCreated event (from the listener).
 */
export function observedFromEthereumEvent(e: {
  orderId: bigint;
  sender: `0x${string}`;
  beneficiary: `0x${string}`;
  token: `0x${string}`;
  amount: bigint;
  safetyDeposit: bigint;
  hashlock: `0x${string}`;
  timelock: bigint;
  blockNumber: bigint;
}): ObservedSourceOrder {
  return {
    sourceChain: "ethereum",
    orderId: e.orderId.toString(),
    sender: e.sender,
    beneficiary: e.beneficiary,
    token: e.token,
    amount: e.amount,
    safetyDeposit: e.safetyDeposit,
    hashlock: e.hashlock,
    timelock: e.timelock
  };
}

/**
 * Convenience factory: build an ObservedSourceOrder from a
 * Soroban contract event (parsed from the raw topics/value).
 *
 * For the dry-run phase the resolver only needs the hashlock (shared
 * across chains), amount, and timelock. The raw Soroban event format
 * depends on the contract's event schema.
 */
export function observedFromSorobanEvent(e: {
  topics: string[];
  value: string;
  ledger: number;
  contractId: string;
}): ObservedSourceOrder | null {
  // The Soroban oversync-htlc contract emits OrderCreated with topics:
  //   topic[0] = event name symbol
  //   topic[1] = orderId (u64)
  //   topic[2] = sender (Address)
  //   topic[3] = beneficiary (Address)
  //
  // value = scvec of (asset, amount, safetyDeposit, hashlock, timelock, ...)
  //
  // For the dry-run scope we parse the minimum required fields.
  // A production fill would use the SDK's SorobanHTLCClient to decode
  // the event properly.

  if (e.topics.length < 4) return null;

  // Attempt to identify the OrderCreated event. The first topic is a
  // symbol (XDR Symbol) encoded as base64; for OrderCreated it should
  // contain "OrderCreated" or a 4-byte selector.
  const eventNameTopic = e.topics[0];
  if (!eventNameTopic.includes("OrderCreated")) {
    return null;
  }

  // For dry-run parsing we use placeholder values since the XDR
  // decoding of Soroban events is non-trivial without the contract
  // spec. The hashlock is carried in the event value or topics
  // depending on the contract's event definition.
  //
  // In a full implementation this would use scValToNative on the
  // topics and value to extract the real fields.
  return {
    sourceChain: "stellar",
    orderId: "0",
    sender: "soroban:unknown",
    beneficiary: "soroban:unknown",
    token: e.contractId,
    amount: 0n,
    safetyDeposit: 0n,
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timelock: 0n
  };
}

export { validateResolverConfig, validateDestinationParams } from "./validate.js";
