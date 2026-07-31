import type { OrderStatus } from "../types/index.js";

// ---------------------------------------------------------------
// HTLC invariant checklist
// ---------------------------------------------------------------

export interface HtlcInvariant {
  id: string;
  category: "settlement" | "refund" | "security" | "recovery";
  summary: string;
  description: string;
}

/**
 * Returns the canonical checklist of HTLC settlement and refund invariants.
 *
 * Every OverSync HTLC order is expected to satisfy these properties.
 * The list is intended to be reused across documentation, test fixtures,
 * and interactive demos.
 */
export function getHtlcInvariantChecklist(): HtlcInvariant[] {
  return [
    {
      id: "same-hashlock",
      category: "settlement",
      summary: "Both legs share the same hashlock",
      description:
        "The source-chain lock and the destination-chain lock are created with the same hashlock value, " +
        "so that revealing the preimage on one chain immediately authorises a claim on the other.",
    },
    {
      id: "dst-timelock-before-src",
      category: "security",
      summary: "Destination timelock expires before source timelock",
      description:
        "The destination-leg timelock is strictly shorter than the source-leg timelock, guaranteeing " +
        "that the beneficiary has time to claim on destination before the source expiry opens a refund window.",
    },
    {
      id: "beneficiary-claim-before-expiry",
      category: "settlement",
      summary: "Beneficiary can claim with a valid preimage before expiry",
      description:
        "While the timelock has not yet expired, the beneficiary (or anyone acting on their behalf) " +
        "may claim the locked funds by providing the correct preimage that hashes to the order's hashlock.",
    },
    {
      id: "refund-after-expiry",
      category: "refund",
      summary: "Refund address receives funds after expiry",
      description:
        "Once the timelock has passed, the refund address can reclaim the locked funds independently, " +
        "without requiring any off-chain permission or preimage.",
    },
    {
      id: "coordinator-cannot-steal",
      category: "security",
      summary: "Coordinator cannot move funds without preimage or expiry",
      description:
        "No off-chain actor (including the swap coordinator) can unilaterally move or claim the locked " +
        "funds unless either (a) the correct preimage is revealed or (b) the timelock has expired.",
    },
    {
      id: "resolver-recovery",
      category: "recovery",
      summary: "Resolver can recover when user does not claim",
      description:
        "If the beneficiary fails to claim before the source-chain timelock expires, the resolver " +
        "may sweep the source-chain funds (minus fees) to a recovery address on behalf of the beneficiary.",
    },
  ];
}

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  announced: ["src_locked", "failed", "expired"],
  src_locked: ["dst_locked", "secret_revealed", "refunded", "failed", "expired"],
  dst_locked: ["secret_revealed", "refunded", "failed", "expired"],
  secret_revealed: ["completed", "refunded", "failed"],
  completed: [],
  refunded: [],
  failed: [],
  expired: ["refunded", "failed"]
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: OrderStatus, public readonly to: OrderStatus) {
    super(`Invalid order transition: ${from} -> ${to}`);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function requireTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function nextStatesOf(status: OrderStatus): OrderStatus[] {
  return [...TRANSITIONS[status]];
}

export {
  simulateRefundTimeline,
  type SimulatorDirection,
  type SimulatedState,
  type RefundTimelineInput,
  type RefundTimelineResult,
} from "./refund-timeline.js";
