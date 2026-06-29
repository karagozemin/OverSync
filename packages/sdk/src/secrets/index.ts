import { sha256, keccak256, toHex } from "viem";

/**
 * A secret + its two-digest commitments. The Stellar/Soroban HTLC
 * verifies sha256, the Ethereum HTLCEscrow verifies both sha256 AND
 * keccak256. Storing both digests lets cross-chain code pick whichever
 * matches its target chain.
 */
export interface Secret {
  /** 32-byte preimage, hex-encoded with 0x prefix. */
  preimage: `0x${string}`;
  /** sha256(preimage) — used by Soroban + EVM. */
  sha256: `0x${string}`;
  /** keccak256(preimage) — convention for vanilla EVM HTLCs. */
  keccak256: `0x${string}`;
}

function isCryptoEnvAvailable(): boolean {
  return typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function";
}

function randomBytes32(): Uint8Array {
  if (isCryptoEnvAvailable()) {
    const buf = new Uint8Array(32);
    globalThis.crypto.getRandomValues(buf);
    return buf;
  }
  // Fallback: throw rather than ship insecure randomness silently.
  throw new Error(
    "Secure random source not available. Run on Node 19+ or in a modern browser, or inject one via the crypto polyfill."
  );
}

function uint8ToHex(buf: Uint8Array): `0x${string}` {
  return ("0x" + Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex string has odd length");
  const buf = new Uint8Array(clean.length / 2);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return buf;
}

/** Generate a fresh 32-byte secret + its digests. */
export function generateSecret(): Secret {
  const preimage = uint8ToHex(randomBytes32());
  return hashSecret(preimage);
}

/** Compute the digests for an existing preimage. */
export function hashSecret(preimage: `0x${string}` | Uint8Array): Secret {
  const hex: `0x${string}` =
    typeof preimage === "string" ? preimage : uint8ToHex(preimage);
  const bytes = typeof preimage === "string" ? hexToUint8(preimage) : preimage;
  return {
    preimage: hex,
    sha256: sha256(toHex(bytes)),
    keccak256: keccak256(toHex(bytes))
  };
}

/**
 * Decide whether `preimage` matches one of the digests in `expected`.
 * Returns the matched digest type, or null if neither matches.
 */
export function verifyPreimage(
  preimage: `0x${string}`,
  expected: `0x${string}`
): "sha256" | "keccak256" | null {
  const s = hashSecret(preimage);
  if (s.sha256 === expected) return "sha256";
  if (s.keccak256 === expected) return "keccak256";
  return null;
}

/**
 * Validates that a string is a well-formed 32-byte hex string with a 0x prefix.
 * Throws a clear error if the format is invalid.
 */
export function assertValidSecretFormat(value: unknown, fieldName: string = "secret"): `0x${string}` {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (!value.startsWith("0x")) {
    throw new Error(`${fieldName} must start with "0x"`);
  }
  const hexPart = value.slice(2);
  if (hexPart.length !== 64) {
    throw new Error(`${fieldName} must be exactly 32 bytes (64 hex characters)`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    throw new Error(`${fieldName} contains invalid hex characters`);
  }
  return value as `0x${string}`;
}
