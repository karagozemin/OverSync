/**
 * Exact cross-chain amount conversion (issue #236).
 *
 * Ethereum and Stellar do not agree on how finely value can be divided. ETH is
 * quoted in wei — 18 decimal places — while Stellar's smallest unit is the
 * stroop, at 7. One stroop is therefore exactly 10^11 wei, and a wei amount
 * that is not a whole number of stroops has no Stellar representation at all.
 *
 * Truncating such an amount would move the difference to whichever side of the
 * bridge rounds last, and a bridge that quietly keeps a remainder is a bridge
 * that does not balance. Every conversion here is integer arithmetic on
 * `bigint` atomic units, and one that cannot be made exactly is refused rather
 * than rounded.
 */

/** Decimal places in an Ethereum native-token amount (wei). */
export const ETHEREUM_DECIMALS = 18;

/** Decimal places in a Stellar amount (stroops). */
export const STELLAR_DECIMALS = 7;

/**
 * Largest amount Stellar can carry: classic balances and Soroban's `i128`
 * amount fields are signed, and the classic ledger caps at a signed 64-bit
 * stroop count.
 */
export const MAX_STELLAR_STROOPS = 2n ** 63n - 1n;

/** Smallest non-zero amount either chain can express, in its own units. */
export const MIN_STELLAR_STROOPS = 1n;
export const MIN_WEI_PER_STROOP = 10n ** BigInt(ETHEREUM_DECIMALS - STELLAR_DECIMALS);

export type AmountErrorCode =
  | "not_a_decimal"
  | "negative"
  | "precision_loss"
  | "overflow";

export type AmountResult<T> = { ok: true; value: T } | { ok: false; code: AmountErrorCode };

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/u;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Reads a decimal string as an exact count of atomic units.
 *
 * The string is never routed through `Number`: at 18 decimals a double cannot
 * even hold 1 ETH in wei without loss. A value finer than the target's smallest
 * unit is refused as `precision_loss`. Trailing zeros are not excess precision —
 * `"1.50"` is exactly `1.5`.
 */
export function parseDecimalToAtomic(value: string, decimals: number): AmountResult<bigint> {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    return { ok: false, code: "not_a_decimal" };
  }

  const [, sign, whole, fraction = ""] = match;
  if (sign === "-") {
    return { ok: false, code: "negative" };
  }

  const mantissa = BigInt(whole + fraction);

  if (fraction.length <= decimals) {
    return { ok: true, value: mantissa * pow10(decimals - fraction.length) };
  }

  const divisor = pow10(fraction.length - decimals);
  if (mantissa % divisor !== 0n) {
    return { ok: false, code: "precision_loss" };
  }

  return { ok: true, value: mantissa / divisor };
}

/** Renders atomic units as a decimal string with exactly `decimals` places. */
export function formatAtomicToDecimal(atomic: bigint, decimals: number): string {
  const negative = atomic < 0n;
  const magnitude = negative ? -atomic : atomic;
  const scale = pow10(decimals);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, "0");

  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/**
 * Rescales an atomic amount between two decimal precisions.
 *
 * Scaling *up* (Stellar to Ethereum) is always exact: every stroop is a whole
 * number of wei. Scaling *down* is exact only when the amount is a whole number
 * of the coarser unit, and is refused otherwise — the caller must decide what
 * to do with a remainder it cannot bridge, rather than have it silently
 * disappear.
 */
export function convertAtomic(input: {
  amount: bigint;
  fromDecimals: number;
  toDecimals: number;
}): AmountResult<bigint> {
  const { amount, fromDecimals, toDecimals } = input;

  if (amount < 0n) {
    return { ok: false, code: "negative" };
  }

  if (toDecimals >= fromDecimals) {
    return { ok: true, value: amount * pow10(toDecimals - fromDecimals) };
  }

  const divisor = pow10(fromDecimals - toDecimals);
  if (amount % divisor !== 0n) {
    return { ok: false, code: "precision_loss" };
  }

  return { ok: true, value: amount / divisor };
}

/**
 * Converts wei to stroops, refusing any amount Stellar cannot carry exactly.
 *
 * Fails with `precision_loss` below one stroop's worth of wei and with
 * `overflow` above the ledger's signed 64-bit stroop ceiling.
 */
export function weiToStroops(wei: bigint): AmountResult<bigint> {
  const converted = convertAtomic({
    amount: wei,
    fromDecimals: ETHEREUM_DECIMALS,
    toDecimals: STELLAR_DECIMALS,
  });

  if (!converted.ok) {
    return converted;
  }

  if (converted.value > MAX_STELLAR_STROOPS) {
    return { ok: false, code: "overflow" };
  }

  return converted;
}

/** Converts stroops to wei. Always exact: one stroop is 10^11 wei. */
export function stroopsToWei(stroops: bigint): AmountResult<bigint> {
  if (stroops > MAX_STELLAR_STROOPS) {
    return { ok: false, code: "overflow" };
  }

  return convertAtomic({
    amount: stroops,
    fromDecimals: STELLAR_DECIMALS,
    toDecimals: ETHEREUM_DECIMALS,
  });
}

/**
 * Whether a wei amount survives a round trip through Stellar unchanged.
 *
 * This is the property the bridge depends on: what is locked on one chain is
 * exactly what is released on the other.
 */
export function isBridgeableWei(wei: bigint): boolean {
  const stroops = weiToStroops(wei);
  if (!stroops.ok) {
    return false;
  }

  const back = stroopsToWei(stroops.value);
  return back.ok && back.value === wei;
}
