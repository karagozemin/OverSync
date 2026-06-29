export type TimelockValidationError = 'TIMELOCKS_REVERSED' | 'GAP_TOO_SMALL';

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
