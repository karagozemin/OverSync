/**
 * Frontend environment validation.
 *
 * Validates required Vite env vars at module-load time (i.e. at build or
 * during dev server start). Import this module early — ideally in main.tsx —
 * so misconfigured builds fail loudly before any UI renders.
 *
 * Mainnet enablement requires BOTH:
 *   VITE_MAINNET_ENABLED=true
 *   VITE_MAINNET_AUDIT_CONFIRMED=true
 * to prevent accidental production deployments.
 */

function e(key: string): string | undefined {
  return (import.meta as any).env?.[key]?.trim() || undefined;
}

/** Collect all validation errors rather than throwing on the first. */
function validateEnv(): void {
  const errors: string[] = [];

  // Required: API base URL
  const apiBase = e("VITE_API_BASE_URL");
  if (!apiBase) {
    errors.push("VITE_API_BASE_URL is required (e.g. http://localhost:3001)");
  } else if (!apiBase.startsWith("http://") && !apiBase.startsWith("https://")) {
    errors.push(`VITE_API_BASE_URL must be a valid HTTP(S) URL (got "${apiBase}")`);
  }

  // Required: network mode
  const networkMode = e("VITE_NETWORK") ?? e("VITE_NETWORK_MODE");
  if (!networkMode) {
    errors.push("VITE_NETWORK is required (testnet or mainnet)");
  } else if (networkMode !== "testnet" && networkMode !== "mainnet") {
    errors.push(`VITE_NETWORK must be 'testnet' or 'mainnet' (got "${networkMode}")`);
  }

  // Mainnet double-confirmation gate.
  // VITE_MAINNET_ENABLED=true alone is NOT sufficient — operators must also
  // set VITE_MAINNET_AUDIT_CONFIRMED=true after completing the checklist in
  // docs/DEPLOYMENT.md#mainnet-rollout-checklist.
  const mainnetEnabled = e("VITE_MAINNET_ENABLED") === "true";
  const mainnetAuditConfirmed = e("VITE_MAINNET_AUDIT_CONFIRMED") === "true";

  if (mainnetEnabled && !mainnetAuditConfirmed) {
    errors.push(
      "VITE_MAINNET_ENABLED=true requires VITE_MAINNET_AUDIT_CONFIRMED=true. " +
        "Complete the checklist in docs/DEPLOYMENT.md#mainnet-rollout-checklist first."
    );
  }

  if (errors.length > 0) {
    const msg =
      "Frontend environment misconfigured:\n" +
      errors.map((e) => `  - ${e}`).join("\n");
    throw new Error(msg);
  }
}

// Run at module load time (build + dev).
validateEnv();

/** Resolved, validated environment values for use in the app. */
export const ENV = {
  apiBaseUrl: e("VITE_API_BASE_URL") as string,
  networkMode: (e("VITE_NETWORK") ?? e("VITE_NETWORK_MODE") ?? "testnet") as "testnet" | "mainnet",
  mainnetEnabled:
    e("VITE_MAINNET_ENABLED") === "true" &&
    e("VITE_MAINNET_AUDIT_CONFIRMED") === "true",
} as const;
