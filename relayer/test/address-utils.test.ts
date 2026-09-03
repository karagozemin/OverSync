import { describe, it, expect } from "vitest";
import {
  isValidAddress,
  isValidTokenAddress,
  isValidWalletAddress,
  normalizeAddress,
  normalizeEthereumAddress,
  normalizeStellarAddress
} from "../src/utils.js";

const ETH_LOWER = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
const ETH_CHECKSUMMED = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ETH_BAD_CHECKSUM = "0x1c7d4B196Cb0C7B01d743Fbc6116a902379C7238";
const STELLAR_VALID = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("relayer normalizeEthereumAddress", () => {
  it("canonicalizes checksummed input to lowercase", () => {
    expect(normalizeEthereumAddress(ETH_CHECKSUMMED)).toBe(ETH_LOWER);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeEthereumAddress(`  ${ETH_CHECKSUMMED} `)).toBe(ETH_LOWER);
  });

  it("rejects a mixed-case address with a broken EIP-55 checksum", () => {
    expect(() => normalizeEthereumAddress(ETH_BAD_CHECKSUM)).toThrow(
      /EIP-55 checksum/
    );
  });

  it("rejects wrong lengths, bad characters, and non-strings", () => {
    // 39 hex digits — the malformed constant that used to circulate in the
    // testnet USDC mapping.
    expect(() =>
      normalizeEthereumAddress("0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b")
    ).toThrow(/40 hex digits/);
    expect(() => normalizeEthereumAddress("0x" + "g".repeat(40))).toThrow(
      /invalid hex/
    );
    expect(() => normalizeEthereumAddress("a0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b234")).toThrow(
      /must start with "0x"/
    );
    expect(() => normalizeEthereumAddress(null)).toThrow(/must be a string/);
  });
});

describe("relayer normalizeStellarAddress / normalizeAddress", () => {
  it("returns the trimmed Stellar account unchanged", () => {
    expect(normalizeStellarAddress(` ${STELLAR_VALID} `)).toBe(STELLAR_VALID);
  });

  it("rejects lowercase and malformed Stellar addresses", () => {
    expect(() => normalizeStellarAddress(STELLAR_VALID.toLowerCase())).toThrow(
      /Stellar account ID/
    );
    expect(() => normalizeStellarAddress("G" + "0".repeat(55))).toThrow(
      /Stellar account ID/
    );
  });

  it("normalizes by shape when the chain is unknown", () => {
    expect(normalizeAddress(ETH_CHECKSUMMED)).toBe(ETH_LOWER);
    expect(normalizeAddress(STELLAR_VALID)).toBe(STELLAR_VALID);
    expect(() => normalizeAddress("junk")).toThrow();
  });
});

describe("relayer validators (format checks used by the quote API)", () => {
  it("accepts well-formed addresses with or without surrounding whitespace", () => {
    expect(isValidWalletAddress(ETH_LOWER)).toBe(true);
    expect(isValidWalletAddress(`  ${ETH_CHECKSUMMED} `)).toBe(true);
    expect(isValidWalletAddress(STELLAR_VALID)).toBe(true);
    expect(isValidWalletAddress(` ${STELLAR_VALID} `)).toBe(true);
    expect(isValidAddress(ETH_LOWER)).toBe(true);
  });

  it("rejects malformed addresses instead of accepting them", () => {
    // 39-hex-digit "address"
    expect(isValidWalletAddress("0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b")).toBe(false);
    expect(isValidTokenAddress("0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b")).toBe(false);
    // mixed case with broken checksum
    expect(isValidWalletAddress(ETH_BAD_CHECKSUM)).toBe(false);
    // lowercase Stellar (case-sensitive format)
    expect(isValidWalletAddress(STELLAR_VALID.toLowerCase())).toBe(false);
    // empty / whitespace-only / non-string
    expect(isValidWalletAddress("   ")).toBe(false);
    expect(isValidWalletAddress("")).toBe(false);
    expect(isValidWalletAddress(undefined as unknown as string)).toBe(false);
  });

  it("still accepts token symbols and Stellar asset codes", () => {
    expect(isValidTokenAddress("USDC")).toBe(true);
    expect(isValidTokenAddress(" usdc ")).toBe(true);
    expect(isValidTokenAddress("XLM")).toBe(true);
  });
});
