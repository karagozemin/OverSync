import type { Order } from "../types/index.js";

export type RefundReasonCode =
  | "UNKNOWN_ORDER"
  | "NOT_EXPIRED"
  | "ALREADY_CLAIMED"
  | "ALREADY_REFUNDED"
  | "ELIGIBLE";

export interface RefundEligibility {
  isEligible: boolean;
  reason: RefundReasonCode;
}

/**
 * Computes refund eligibility for a given cross-chain order.
 * Assesses whether the user's source funds can be safely refunded
 * based on the order's status, timelock, and the current time.
 *
 * @param order The normalized cross-chain order
 * @param currentTimeSeconds The current unix timestamp in seconds (defaults to Date.now() / 1000)
 */
export function checkRefundEligibility(
  order: Order | null | undefined,
  currentTimeSeconds: number = Math.floor(Date.now() / 1000)
): RefundEligibility {
  if (!order) {
    return { isEligible: false, reason: "UNKNOWN_ORDER" };
  }

  // If there's no timelock on the source leg, funds haven't been locked on-chain
  // so there is nothing to refund.
  if (!order.src.timelock) {
    return { isEligible: false, reason: "UNKNOWN_ORDER" };
  }

  if (order.status === "refunded") {
    return { isEligible: false, reason: "ALREADY_REFUNDED" };
  }

  if (order.status === "completed" || order.status === "secret_revealed") {
    return { isEligible: false, reason: "ALREADY_CLAIMED" };
  }

  if (currentTimeSeconds < order.src.timelock) {
    return { isEligible: false, reason: "NOT_EXPIRED" };
  }

  return { isEligible: true, reason: "ELIGIBLE" };
}
