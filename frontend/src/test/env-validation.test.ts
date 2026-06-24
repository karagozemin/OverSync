/**
 * Tests for the Vite build-time env validation plugin logic.
 *
 * We extract the validation rules inline rather than importing vite.config.ts
 * (which would require Vite to be fully initialised). This keeps the tests
 * fast and dependency-free.
 */
import { describe, it, expect } from "vitest";

/**
 * Mirrors the validation logic in vite.config.ts envValidationPlugin.
 * Returns a list of error strings, or an empty array on success.
 */
function validateFrontendEnv(env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];

  const apiBase = env["VITE_API_BASE_URL"]?.trim();
  if (!apiBase) {
    errors.push("VITE_API_BASE_URL is required");
  } else if (!apiBase.startsWith("http://") && !apiBase.startsWith("https://")) {
    errors.push(`VITE_API_BASE_URL must be a valid HTTP(S) URL (got "${apiBase}")`);
  }

  const networkMode = (env["VITE_NETWORK"] ?? env["VITE_NETWORK_MODE"])?.trim();
  if (!networkMode) {
    errors.push("VITE_NETWORK is required");
  } else if (networkMode !== "testnet" && networkMode !== "mainnet") {
    errors.push(`VITE_NETWORK must be 'testnet' or 'mainnet' (got "${networkMode}")`);
  }

  const mainnetEnabled = env["VITE_MAINNET_ENABLED"] === "true";
  const auditConfirmed = env["VITE_MAINNET_AUDIT_CONFIRMED"] === "true";
  if (mainnetEnabled && !auditConfirmed) {
    errors.push(
      "VITE_MAINNET_ENABLED=true requires VITE_MAINNET_AUDIT_CONFIRMED=true"
    );
  }

  return errors;
}

const VALID_BASE = {
  VITE_API_BASE_URL: "http://localhost:3001",
  VITE_NETWORK: "testnet",
  VITE_MAINNET_ENABLED: "false",
  VITE_MAINNET_AUDIT_CONFIRMED: "false",
};

describe("frontend build-time env validation", () => {
  it("passes with a valid testnet config", () => {
    expect(validateFrontendEnv(VALID_BASE)).toHaveLength(0);
  });

  it("fails when VITE_API_BASE_URL is missing", () => {
    const errors = validateFrontendEnv({ ...VALID_BASE, VITE_API_BASE_URL: undefined });
    expect(errors.some((e) => e.includes("VITE_API_BASE_URL"))).toBe(true);
  });

  it("fails when VITE_API_BASE_URL is not a URL", () => {
    const errors = validateFrontendEnv({ ...VALID_BASE, VITE_API_BASE_URL: "localhost:3001" });
    expect(errors.some((e) => e.includes("HTTP(S)"))).toBe(true);
  });

  it("fails when VITE_NETWORK is missing", () => {
    const errors = validateFrontendEnv({
      ...VALID_BASE,
      VITE_NETWORK: undefined,
      VITE_NETWORK_MODE: undefined,
    });
    expect(errors.some((e) => e.includes("VITE_NETWORK"))).toBe(true);
  });

  it("fails when VITE_NETWORK has an invalid value", () => {
    const errors = validateFrontendEnv({ ...VALID_BASE, VITE_NETWORK: "localhost" });
    expect(errors.some((e) => e.includes("testnet"))).toBe(true);
  });

  it("fails when VITE_MAINNET_ENABLED=true without VITE_MAINNET_AUDIT_CONFIRMED=true", () => {
    const errors = validateFrontendEnv({
      ...VALID_BASE,
      VITE_NETWORK: "mainnet",
      VITE_MAINNET_ENABLED: "true",
      VITE_MAINNET_AUDIT_CONFIRMED: "false",
    });
    expect(errors.some((e) => e.includes("VITE_MAINNET_AUDIT_CONFIRMED"))).toBe(true);
  });

  it("passes when both mainnet flags are true", () => {
    const errors = validateFrontendEnv({
      ...VALID_BASE,
      VITE_NETWORK: "mainnet",
      VITE_MAINNET_ENABLED: "true",
      VITE_MAINNET_AUDIT_CONFIRMED: "true",
    });
    expect(errors).toHaveLength(0);
  });
});
