import type { Chain, Direction } from "@oversync/sdk/types";

/**
 * A source-chain order observed by a listener, normalised so the
 * planner can treat both Ethereum and Soroban events uniformly.
 */
export interface ObservedSourceOrder {
  sourceChain: Chain;
  orderId: string;
  sender: string;
  beneficiary: string;
  token: string;
  amount: bigint;
  safetyDeposit: bigint;
  hashlock: `0x${string}`;
  /** Absolute timelock in unix seconds. */
  timelock: bigint;
}

/**
 * Parameters needed to call `createOrder` (or `create_order`) on the
 * destination chain. These are the counterpart leg of a resolver fill.
 */
export interface DestinationOrderParams {
  destinationChain: Chain;
  beneficiary: string;
  refundAddress: string;
  token: string;
  amount: bigint;
  safetyDeposit: bigint;
  hashlock: `0x${string}`;
  /** Relative timelock in seconds (added to block.timestamp by the contract). */
  timelockSeconds: bigint;
}

/**
 * A complete dry-run fill plan: what the resolver WOULD submit.
 */
export interface FillPlan {
  source: ObservedSourceOrder;
  destination: DestinationOrderParams;
  direction: Direction;
}

export type PlanResult =
  | { ok: true; plan: FillPlan }
  | { ok: false; errors: string[] };
