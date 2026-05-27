import { describe, it, expect } from "vitest";
import { resolveStellarAsset, resolveEthereumToken } from "../src/assets/index.js";

const SEPOLIA_USDC = "0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b";
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
});
