import { describe, it, expect } from "vitest";
import { getCapabilityMatrix } from "../src/assets/capabilities.js";

describe("SDK capability matrix", () => {
  it("exposes supported chains, routes, and caveats correctly", () => {
    const matrix = getCapabilityMatrix();
    expect(matrix.supportedChains).toContain("ethereum");
    expect(matrix.supportedChains).toContain("stellar");
    expect(matrix.caveatsForUnsupportedRoutes).toHaveProperty("solana");
    expect(matrix.caveatsForUnsupportedRoutes).toHaveProperty("bitcoin");
  });

  it("describes the ETH -> XLM capability row for testnet", () => {
    const matrix = getCapabilityMatrix();
    const ethToXlmRoute = matrix.routes.find(r => r.direction === "eth_to_xlm");
    expect(ethToXlmRoute).toBeDefined();
    expect(ethToXlmRoute!.fromChain).toBe("ethereum");
    expect(ethToXlmRoute!.toChain).toBe("stellar");
    expect(ethToXlmRoute!.mainnetStatus).toBe("gated_until_audit");

    const ethAsset = ethToXlmRoute!.supportedAssets.find(a => a.fromAsset === "ETH");
    expect(ethAsset).toBeDefined();
    expect(ethAsset!.toAsset).toBe("XLM");
    expect(ethAsset!.testnetAddressOrCode).toBe("0x0000000000000000000000000000000000000000");
  });

  it("describes the XLM -> ETH capability row for testnet", () => {
    const matrix = getCapabilityMatrix();
    const xlmToEthRoute = matrix.routes.find(r => r.direction === "xlm_to_eth");
    expect(xlmToEthRoute).toBeDefined();
    expect(xlmToEthRoute!.fromChain).toBe("stellar");
    expect(xlmToEthRoute!.toChain).toBe("ethereum");
    expect(xlmToEthRoute!.mainnetStatus).toBe("gated_until_audit");

    const xlmAsset = xlmToEthRoute!.supportedAssets.find(a => a.fromAsset === "XLM");
    expect(xlmAsset).toBeDefined();
    expect(xlmAsset!.toAsset).toBe("ETH");
    expect(xlmAsset!.testnetAddressOrCode).toBe("XLM");
  });
});
