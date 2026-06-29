import { describe, it, expect } from "vitest";
import { checkNetworkMode } from "../src/types/network-mode.js";

describe("SDK network mode guard", () => {
  it("allows testnet operations when testnet mode is active", () => {
    const res = checkNetworkMode("testnet", false);
    expect(res.mode).toBe("testnet");
    expect(res.status).toBe("testnet");
    expect(res.disableUiActions).toBe(false);
  });

  it("gates mainnet operations when mainnet is disabled", () => {
    const res = checkNetworkMode("mainnet", false);
    expect(res.mode).toBe("mainnet");
    expect(res.status).toBe("mainnet_gated");
    expect(res.disableUiActions).toBe(true);
    expect(res.reason).toContain("currently gated");
  });

  it("allows mainnet operations when mainnet is fully enabled", () => {
    const res = checkNetworkMode("mainnet", true);
    expect(res.mode).toBe("mainnet");
    expect(res.status).toBe("mainnet_enabled");
    expect(res.disableUiActions).toBe(false);
  });
});
