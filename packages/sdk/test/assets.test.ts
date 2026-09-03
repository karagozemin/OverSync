import { describe, it, expect } from "vitest";
import { resolveStellarAsset, resolveEthereumToken } from "../src/assets/index.js";
import { AddressValidationError } from "../src/addresses/index.js";

const SEPOLIA_USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
// EIP-55 checksummed form of the same address.
const SEPOLIA_USDC_CHECKSUMMED = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_USDC_STELLAR = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

describe("SDK asset mappings", () => {
  it("maps native ETH to native XLM on testnet", () => {
    expect(resolveStellarAsset("0x0000000000000000000000000000000000000000", "testnet")).toEqual({ code: "XLM" });
  });

  it("maps a known ERC-20 token to Stellar USDC on testnet", () => {
    expect(resolveStellarAsset(SEPOLIA_USDC, "testnet")).toEqual(SEPOLIA_USDC_STELLAR);
  });

  it("falls back to native XLM for an unknown Ethereum token address on testnet", () => {
    expect(resolveStellarAsset("0x1111111111111111111111111111111111111111", "testnet")).toEqual({ code: "XLM" });
  });

  it("resolves a known Stellar USDC asset back to the Sepolia ERC-20 token address", () => {
    expect(resolveEthereumToken(SEPOLIA_USDC_STELLAR, "testnet")).toBe(SEPOLIA_USDC);
  });

  it("falls back to native ETH for an unknown Stellar asset on testnet", () => {
    expect(resolveEthereumToken("UNKNOWN_ASSET", "testnet")).toBe("0x0000000000000000000000000000000000000000");
  });

  it("maps USDC from an EIP-55 checksummed, whitespace-padded token address", () => {
    expect(resolveStellarAsset(`  ${SEPOLIA_USDC_CHECKSUMMED} `, "testnet")).toEqual(SEPOLIA_USDC_STELLAR);
  });

  it("rejects a malformed Ethereum token address instead of silently mapping it to XLM", () => {
    // Regression: a 39-hex-digit "address" used to resolve to native XLM,
    // a false match that could route the wrong asset across the bridge.
    expect(() =>
      resolveStellarAsset("0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b", "testnet")
    ).toThrow(AddressValidationError);
    expect(() => resolveStellarAsset("not-an-address", "testnet")).toThrow(
      AddressValidationError
    );
    expect(() => resolveStellarAsset("", "testnet")).toThrow(AddressValidationError);
  });

  it("rejects a mixed-case token address with an invalid EIP-55 checksum", () => {
    expect(() =>
      resolveStellarAsset("0x1c7d4B196Cb0C7B01d743Fbc6116a902379C7238", "testnet")
    ).toThrow(/EIP-55 checksum/);
  });

  it("resolves USDC when the issuer is whitespace-padded", () => {
    expect(
      resolveEthereumToken(
        { code: "USDC", issuer: ` ${SEPOLIA_USDC_STELLAR.issuer} ` },
        "testnet"
      )
    ).toBe(SEPOLIA_USDC);
    expect(resolveEthereumToken(`USDC:${SEPOLIA_USDC_STELLAR.issuer}`, "testnet")).toBe(
      SEPOLIA_USDC
    );
  });

  it("rejects a Stellar asset with a malformed issuer address", () => {
    expect(() => resolveEthereumToken("USDC:garbage", "testnet")).toThrow(AddressValidationError);
    expect(() =>
      resolveEthereumToken(
        { code: "USDC", issuer: SEPOLIA_USDC_STELLAR.issuer.toLowerCase() },
        "testnet"
      )
    ).toThrow(AddressValidationError);
  });
});
