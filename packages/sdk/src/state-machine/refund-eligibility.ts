import type { Direction, OrderStatus } from "../types/index.js";

export type RefundEligibilityReasonCode =
  | "not_expired"
  | "already_claimed"
  | "already_refunded"
  | "eligible"
  | "unknown_order";

export interface RefundEligibilityInput {
  status?: OrderStatus | string | null;
  timelock?: number | bigint | null;
  direction?: Direction | string | null;
  nowUnixSeconds?: number;
}

export interface RefundEligibilityResult {
  eligible: boolean;
  reasonCode: RefundEligibilityReasonCode;
  reason: string;
  timeRemainingSeconds: number;
}

/**
 * Computes read-only refund eligibility from an order's status, timelock,
 * direction, and current unix timestamp.
 */
export function computeRefundEligibility(
  input?: RefundEligibilityInput | null
): RefundEligibilityResult {
  const now = input?.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const status = input?.status;

  // Unknown order
  if (!status || status === "unknown" || status === "unknown_order") {
    return {
      eligible: false,
      reasonCode: "unknown_order",
      reason: "unknown order",
      timeRemainingSeconds: 0,
    };
  }

  // Already refunded
  if (status === "refunded") {
    return {
      eligible: false,
      reasonCode: "already_refunded",
      reason: "already refunded",
      timeRemainingSeconds: 0,
    };
  }

  // Already claimed
  if (status === "completed" || status === "secret_revealed") {
    return {
      eligible: false,
      reasonCode: "already_claimed",
      reason: "already claimed",
      timeRemainingSeconds: 0,
    };
  }

  // Active or failed or expired statuses
  const timelock = input?.timelock != null ? Number(input.timelock) : 0;
  const isExpired = timelock > 0 && now >= timelock;

  if (isExpired) {
    return {
      eligible: true,
      reasonCode: "eligible",
      reason: "eligible",
      timeRemainingSeconds: 0,
    };
  }

  // Timelock has not expired yet or not yet set on-chain
  const timeRemainingSeconds = timelock > 0 ? Math.max(0, timelock - now) : 0;
  return {
    eligible: false,
    reasonCode: "not_expired",
    reason: "not expired",
    timeRemainingSeconds,
  };
}
