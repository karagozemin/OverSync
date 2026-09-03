import { checksumAddress } from "viem";

/**
 * Address canonicalization + validation for the two chains supported by
 * OverSync.
 *
 * Cross-chain order comparison is only safe when every participant stores
 * and compares addresses in a single canonical form:
 *
 *  - Ethereum addresses are case-insensitive hex (0x + 40 hex digits).
 *    Canonical form is LOWERCASE. Mixed-case input must carry a valid
 *    EIP-55 checksum; anything else is rejected.
 *  - Stellar account IDs (G + 55 base32 chars) are case-SENSITIVE, so
 *    canonical form is the trimmed value as-is; any other casing or
 *    character set is rejected.
 *
 * All functions trim surrounding whitespace before validating so that
 * copy/pasted values (" 0xabc…\n") canonicalize instead of being stored
 * as a distinct value and never matching again.
 */

export class AddressValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressValidationError";
  }
}

export type SupportedChain = "ethereum" | "stellar";

const STELLAR_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new AddressValidationError(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AddressValidationError(`${fieldName} must not be empty`);
  }
  return trimmed;
}

/**
 * Canonicalize an Ethereum address.
 *
 * Accepts lowercase, uppercase, and valid EIP-55 mixed-case input (with
 * optional surrounding whitespace) and returns the lowercase form.
 * Throws {@link AddressValidationError} for malformed input, including
 * mixed-case input with an invalid EIP-55 checksum.
 */
export function normalizeEthereumAddress(
  value: unknown,
  fieldName = "Ethereum address"
): string {
  const raw = assertNonEmptyString(value, fieldName);

  if (!raw.startsWith("0x")) {
    throw new AddressValidationError(
      `${fieldName} must start with "0x" (got "${raw.slice(0, 2)}…")`
    );
  }

  const hexPart = raw.slice(2);
  if (hexPart.length !== 40) {
    throw new AddressValidationError(
      `${fieldName} must be 40 hex digits after 0x (got ${hexPart.length})`
    );
  }
  if (!HEX_RE.test(hexPart)) {
    throw new AddressValidationError(
      `${fieldName} contains invalid hex characters`
    );
  }

  // EIP-55: all-lowercase and all-uppercase input is always acceptable;
  // mixed-case input must exactly match the derived checksum. (viem's
  // getAddress only re-derives the checksum, so the comparison is done
  // here explicitly.)
  const hasUppercase = /[A-F]/.test(raw);
  const hasLowercase = /[a-f]/.test(raw);
  if (hasUppercase && hasLowercase) {
    // `raw` is known to be 0x + 40 hex digits at this point.
    const expected = checksumAddress(raw.toLowerCase() as `0x${string}`);
    if (raw !== expected) {
      throw new AddressValidationError(
        `${fieldName} has an invalid EIP-55 checksum (expected ${expected})`
      );
    }
  }

  return raw.toLowerCase();
}

/**
 * Canonicalize a Stellar account address (G + 55 base32 chars).
 *
 * Stellar account IDs are case-sensitive, so the canonical form is the
 * trimmed string itself. Throws {@link AddressValidationError} for
 * lowercase/mixed-case input, wrong lengths, or non-base32 characters.
 */
export function normalizeStellarAddress(
  value: unknown,
  fieldName = "Stellar address"
): string {
  const raw = assertNonEmptyString(value, fieldName);

  if (!STELLAR_ACCOUNT_RE.test(raw)) {
    throw new AddressValidationError(
      `${fieldName} must be a Stellar account ID (G + 55 base32 characters)`
    );
  }
  return raw;
}

/**
 * Canonicalize an address when the chain is known.
 */
export function normalizeChainAddress(
  chain: SupportedChain,
  value: unknown,
  fieldName?: string
): string {
  if (chain === "ethereum") {
    return normalizeEthereumAddress(value, fieldName ?? "Ethereum address");
  }
  if (chain === "stellar") {
    return normalizeStellarAddress(value, fieldName ?? "Stellar address");
  }
  throw new AddressValidationError(`unsupported chain "${String(chain)}"`);
}

/**
 * Canonicalize an address when the chain is NOT known, by shape:
 * `0x…` → Ethereum, `G…` → Stellar. Everything else is rejected.
 *
 * Used for endpoints such as order-history lookup, where the caller
 * may pass either an Ethereum or a Stellar address.
 */
export function normalizeAddress(
  value: unknown,
  fieldName = "address"
): string {
  const raw = assertNonEmptyString(value, fieldName);
  if (raw.startsWith("0x")) {
    return normalizeEthereumAddress(raw, fieldName);
  }
  return normalizeStellarAddress(raw, fieldName);
}

/**
 * True when both values are the same on-chain address, ignoring
 * formatting differences (whitespace, Ethereum hex casing, EIP-55
 * checksum form). Returns false if either value is malformed for the
 * chain instead of throwing, so callers can use it as a safe predicate.
 */
export function sameChainAddress(
  chain: SupportedChain,
  a: unknown,
  b: unknown
): boolean {
  try {
    return normalizeChainAddress(chain, a) === normalizeChainAddress(chain, b);
  } catch {
    return false;
  }
}

/**
 * Format-aware counterpart of {@link sameChainAddress} for the
 * "chain unknown" case (auto-detects from the 0x / G prefix).
 */
export function sameAddress(a: unknown, b: unknown): boolean {
  try {
    return normalizeAddress(a) === normalizeAddress(b);
  } catch {
    return false;
  }
}
