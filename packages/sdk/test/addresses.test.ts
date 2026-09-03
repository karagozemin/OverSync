import { describe, it, expect } from "vitest";
import {
  AddressValidationError,
  normalizeAddress,
  normalizeChainAddress,
  normalizeEthereumAddress,
  normalizeStellarAddress,
  sameAddress,
  sameChainAddress
} from "../src/addresses/index.js";

const ETH_LOWER = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
// EIP-55 checksummed form of the same address (Sepolia USDC).
const ETH_CHECKSUMMED = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
// Same bytes as ETH_CHECKSUMMED but with one alpha character in the
// wrong case relative to its keccak256 checksum → invalid.
const ETH_BAD_CHECKSUM = "0x1c7d4B196Cb0C7B01d743Fbc6116a902379C7238";

const STELLAR_VALID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("normalizeEthereumAddress", () => {
  it("returns the lowercase canonical form for lowercase input", () => {
    expect(normalizeEthereumAddress(ETH_LOWER)).toBe(ETH_LOWER);
  });

  it("returns the lowercase canonical form for EIP-55 checksummed input", () => {
    expect(normalizeEthereumAddress(ETH_CHECKSUMMED)).toBe(ETH_LOWER);
  });

  it("returns the lowercase canonical form for all-uppercase hex input", () => {
    expect(normalizeEthereumAddress("0x" + ETH_LOWER.slice(2).toUpperCase())).toBe(ETH_LOWER);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(normalizeEthereumAddress(`  ${ETH_CHECKSUMMED}\n`)).toBe(ETH_LOWER);
  });

  it("accepts the zero address (native ETH sentinel)", () => {
    expect(normalizeEthereumAddress("0x0000000000000000000000000000000000000000")).toBe(
      "0x0000000000000000000000000000000000000000"
    );
  });

  it("rejects mixed-case input with an invalid EIP-55 checksum", () => {
    expect(() => normalizeEthereumAddress(ETH_BAD_CHECKSUM)).toThrow(AddressValidationError);
    expect(() => normalizeEthereumAddress(ETH_BAD_CHECKSUM)).toThrow(
      /EIP-55 checksum/
    );
  });

  it("rejects input without the 0x prefix", () => {
    expect(() => normalizeEthereumAddress(ETH_LOWER.slice(2))).toThrow(
      /must start with "0x"/
    );
  });

  it("rejects uppercase 0X prefix", () => {
    expect(() => normalizeEthereumAddress("0X" + ETH_LOWER.slice(2))).toThrow(
      /must start with "0x"/
    );
  });

  it("rejects addresses that are too short (39 hex digits)", () => {
    // Regression: the old testnet USDC constant was 39 hex digits and was
    // silently accepted as a token address.
    expect(() =>
      normalizeEthereumAddress("0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b")
    ).toThrow(/40 hex digits/);
  });

  it("rejects addresses that are too long (41 hex digits)", () => {
    expect(() => normalizeEthereumAddress(ETH_LOWER + "a")).toThrow(/40 hex digits/);
  });

  it("rejects non-hex characters", () => {
    expect(() => normalizeEthereumAddress("0x1c7d4b196cb0c7b01d743fbc6116a902379c723g")).toThrow(
      /invalid hex/
    );
  });

  it("rejects internal whitespace", () => {
    expect(() => normalizeEthereumAddress("0x1c7d4b196cb0c7b 01d743fbc6116a902379c7238")).toThrow(
      /40 hex digits|invalid hex/
    );
  });

  it("rejects empty and whitespace-only input", () => {
    expect(() => normalizeEthereumAddress("")).toThrow(/must not be empty/);
    expect(() => normalizeEthereumAddress("   ")).toThrow(/must not be empty/);
  });

  it("rejects non-string input", () => {
    expect(() => normalizeEthereumAddress(12345)).toThrow(/must be a string/);
    expect(() => normalizeEthereumAddress(null)).toThrow(/must be a string/);
    expect(() => normalizeEthereumAddress(undefined)).toThrow(/must be a string/);
  });

  it("surfaces the field name in error messages", () => {
    expect(() => normalizeEthereumAddress("nope", "srcAddress")).toThrow(/srcAddress/);
  });
});

describe("normalizeStellarAddress", () => {
  it("returns the trimmed value unchanged for a valid account", () => {
    expect(normalizeStellarAddress(STELLAR_VALID)).toBe(STELLAR_VALID);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeStellarAddress(` ${STELLAR_VALID} `)).toBe(STELLAR_VALID);
  });

  it("rejects lowercase input (Stellar IDs are case-sensitive)", () => {
    expect(() => normalizeStellarAddress(STELLAR_VALID.toLowerCase())).toThrow(
      /Stellar account ID/
    );
  });

  it("rejects mixed-case input", () => {
    const mixed = "g" + STELLAR_VALID.slice(1);
    expect(() => normalizeStellarAddress(mixed)).toThrow(/Stellar account ID/);
  });

  it("rejects wrong lengths", () => {
    expect(() => normalizeStellarAddress(STELLAR_VALID.slice(0, 55))).toThrow(
      /Stellar account ID/
    );
    expect(() => normalizeStellarAddress(STELLAR_VALID + "A")).toThrow(/Stellar account ID/);
  });

  it("rejects non-base32 characters (0, 1, 8, 9 are not in the base32 alphabet)", () => {
    expect(() => normalizeStellarAddress("G" + "0".repeat(55))).toThrow(/Stellar account ID/);
    expect(() => normalizeStellarAddress("G" + "A".repeat(54) + "8")).toThrow(/Stellar account ID/);
  });

  it("rejects the zero Ethereum address when passed as a Stellar address", () => {
    expect(() =>
      normalizeStellarAddress("0x0000000000000000000000000000000000000000")
    ).toThrow(/Stellar account ID/);
  });

  it("rejects empty and non-string input", () => {
    expect(() => normalizeStellarAddress("  ")).toThrow(/must not be empty/);
    expect(() => normalizeStellarAddress(42)).toThrow(/must be a string/);
  });
});

describe("normalizeChainAddress", () => {
  it("dispatches on the chain", () => {
    expect(normalizeChainAddress("ethereum", ETH_CHECKSUMMED)).toBe(ETH_LOWER);
    expect(normalizeChainAddress("stellar", STELLAR_VALID)).toBe(STELLAR_VALID);
  });

  it("rejects an Ethereum address when the chain is stellar", () => {
    expect(() => normalizeChainAddress("stellar", ETH_LOWER)).toThrow(/Stellar account ID/);
  });

  it("rejects a Stellar address when the chain is ethereum", () => {
    expect(() => normalizeChainAddress("ethereum", STELLAR_VALID)).toThrow(
      /must start with "0x"/
    );
  });

  it("rejects an unsupported chain", () => {
    expect(() => normalizeChainAddress("bitcoin" as never, "bc1q")).toThrow(
      /unsupported chain/
    );
  });
});

describe("normalizeAddress (chain inferred from shape)", () => {
  it("routes 0x-prefixed input to the Ethereum rules", () => {
    expect(normalizeAddress(ETH_CHECKSUMMED)).toBe(ETH_LOWER);
  });

  it("routes G-prefixed input to the Stellar rules", () => {
    expect(normalizeAddress(STELLAR_VALID)).toBe(STELLAR_VALID);
  });

  it("rejects malformed Ethereum input", () => {
    expect(() => normalizeAddress("0x123")).toThrow(/40 hex digits/);
    expect(() => normalizeAddress(ETH_BAD_CHECKSUM)).toThrow(/EIP-55 checksum/);
  });

  it("rejects malformed Stellar input", () => {
    expect(() => normalizeAddress("G" + "a".repeat(55))).toThrow(/Stellar account ID/);
  });

  it("rejects garbage input", () => {
    expect(() => normalizeAddress("hello")).toThrow(/Stellar account ID|must start with/);
  });
});

describe("sameChainAddress / sameAddress", () => {
  it("matches an address against itself in different formats", () => {
    expect(sameChainAddress("ethereum", ETH_CHECKSUMMED, ETH_LOWER)).toBe(true);
    expect(sameChainAddress("ethereum", ` ${ETH_LOWER} `, ETH_CHECKSUMMED)).toBe(true);
    expect(sameAddress(ETH_CHECKSUMMED, ETH_LOWER)).toBe(true);
  });

  it("matches Stellar addresses case-exactly", () => {
    expect(sameChainAddress("stellar", STELLAR_VALID, ` ${STELLAR_VALID} `)).toBe(true);
    expect(sameChainAddress("stellar", STELLAR_VALID, STELLAR_VALID.toLowerCase())).toBe(
      false
    );
  });

  it("does not match distinct addresses", () => {
    const other = "0x2c7d4b196cb0c7b01d743fbc6116a902379c7238";
    expect(sameChainAddress("ethereum", ETH_LOWER, other)).toBe(false);
    expect(sameAddress(ETH_LOWER, STELLAR_VALID)).toBe(false);
  });

  it("returns false instead of throwing when either side is malformed", () => {
    expect(sameChainAddress("ethereum", ETH_BAD_CHECKSUM, ETH_LOWER)).toBe(false);
    expect(sameChainAddress("stellar", ETH_LOWER, STELLAR_VALID)).toBe(false);
    expect(sameAddress("0x123", ETH_LOWER)).toBe(false);
  });
});
