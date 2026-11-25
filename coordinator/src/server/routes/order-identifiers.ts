import type { Response } from "express";

/** Covers public IDs and on-chain identifiers, including uint256 decimal strings. */
export const MAX_ORDER_ID_LENGTH = 128;

export function isOrderIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ORDER_ID_LENGTH &&
    value === value.trim() &&
    !/\p{Cc}/u.test(value);
}

export function rejectInvalidOrderId(res: Response): void {
  res.status(400).json({ error: "invalid_order_id" });
}
