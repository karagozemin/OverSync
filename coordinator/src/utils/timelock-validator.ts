export type TimelockValidationError = 'TIMELOCKS_REVERSED' | 'GAP_TOO_SMALL';

export type RefundChain = 'ethereum' | 'stellar';

export interface RefundEligibility {
  eligible: boolean;
  lockedSides: Array<{
    chain: RefundChain;
    earliestRefundAt: number | null;
  }>;
}

/** Evaluates both persisted chain timelocks using one coordinator clock. */
export function evaluateRefundEligibility(
  timelocks: Record<RefundChain, number | null>,
  nowUnixSeconds: number
): RefundEligibility {
  const lockedSides = (Object.entries(timelocks) as Array<[RefundChain, number | null]>)
    .filter(([, timelock]) => timelock === null || nowUnixSeconds <= timelock)
    .map(([chain, timelock]) => ({
      chain,
      earliestRefundAt: timelock === null ? null : timelock + 1
    }));

  return { eligible: lockedSides.length === 0, lockedSides };
}

/**
 * Validates that the destination timelock is safely before the source timelock.
 *
 * @param srcTimelock The source chain timelock (in seconds)
 * @param dstTimelock The destination chain timelock (in seconds)
 * @param minGapSeconds The minimum required gap between timelocks (in seconds)
 * @returns An object indicating validity and an optional error type
 */
export function validateTimelockOrdering(
  srcTimelock: number,
  dstTimelock: number,
  minGapSeconds: number
): { isValid: boolean; error?: TimelockValidationError } {
  if (dstTimelock >= srcTimelock) {
    return { isValid: false, error: 'TIMELOCKS_REVERSED' };
  }
  if (srcTimelock - dstTimelock < minGapSeconds) {
    return { isValid: false, error: 'GAP_TOO_SMALL' };
  }
  return { isValid: true };
}

/**
 * Validates source/destination timelock ordering at order-creation time.
 * Alias for {@link validateTimelockOrdering} used by the coordinator service layer.
 */
export function validateTimelocksAtCreation(
  srcTimelock: number,
  dstTimelock: number,
  minGapSeconds: number
): { isValid: boolean; error?: TimelockValidationError } {
  return validateTimelockOrdering(srcTimelock, dstTimelock, minGapSeconds);
}

/**
 * Whether the secret-reveal window is open for an order at `nowSec` (#254).
 *
 * A timelock of `null`/`0` means "not set yet" and does not expire — the
 * order state machine still prevents storing a secret before the
 * corresponding lock exists. A window has closed when the current time is
 * strictly past the timelock; at exactly the timelock second the window is
 * still open.
 *
 * Pure function so tests inject any clock by passing `nowSec` directly.
 */
export function evaluateSecretWindow(
  srcTimelock: number | null | undefined,
  dstTimelock: number | null | undefined,
  nowSec: number
): { open: boolean; error?: SecretWindowError } {
  if (srcTimelock != null && srcTimelock > 0 && nowSec > srcTimelock) {
    return { open: false, error: 'SRC_TIMELOCK_EXPIRED' };
  }
  if (dstTimelock != null && dstTimelock > 0 && nowSec > dstTimelock) {
    return { open: false, error: 'DST_TIMELOCK_EXPIRED' };
  }
  return { open: true };
}
