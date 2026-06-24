/**
 * Load-test configuration.
 *
 * All knobs are driven by environment variables so the harness is
 * reproducible in CI. Safe dry-run defaults mean contributors can run
 * locally without any live RPC or private keys.
 *
 * Env vars:
 *   LOAD_TEST_LIVE=true          — opt in to live Sepolia/Stellar testnet
 *   LOAD_TEST_SEED               — PRNG seed (default: "oversync-soak-2026")
 *   LOAD_TEST_ORDERS             — order count (default: 10 dry-run / 100 live)
 *   LOAD_TEST_CONCURRENCY        — parallel workers (default: 10 dry-run / 5 live)
 *   LOAD_TEST_RATE_PER_SEC       — orders/sec rate cap (default: 100 dry-run / 3 live)
 *   LOAD_TEST_TIMELOCK_SEC       — HTLC timelock in seconds (default: 600)
 *   LOAD_TEST_OUTPUT_DIR         — where reports land (default: load-test/reports)
 *   LOAD_TEST_ALLOW_LARGE=true   — bypass the 100-order live-mode safeguard
 *
 *   Live mode also requires at least one of:
 *     SEPOLIA_RPC_URL or INFURA_API_KEY
 *     RESOLVER_ETH_PRIVATE_KEY
 */

export interface LoadTestConfig {
  dryRun: boolean;
  seed: string;
  orders: number;
  concurrency: number;
  rateLimitPerSec: number;
  timelockSeconds: number;
  outputDir: string;
  sepoliaRpcUrl: string | null;
  sorobanRpcUrl: string | null;
}

function parsePositiveInt(name: string, defaultVal: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${raw}`);
  }
  if (n > max) {
    throw new Error(
      `${name}=${n} exceeds the safety cap of ${max}. ` +
        "Set LOAD_TEST_ALLOW_LARGE=true to override."
    );
  }
  return n;
}

export function loadConfig(): LoadTestConfig {
  const dryRun = process.env.LOAD_TEST_LIVE !== "true";
  const allowLarge = process.env.LOAD_TEST_ALLOW_LARGE === "true";

  const orderCap = allowLarge ? 100_000 : dryRun ? 10_000 : 100;
  const defaultOrders = dryRun ? 10 : 100;

  const orders = parsePositiveInt("LOAD_TEST_ORDERS", defaultOrders, orderCap);
  const concurrency = parsePositiveInt(
    "LOAD_TEST_CONCURRENCY",
    dryRun ? 10 : 5,
    dryRun ? 200 : 50
  );
  const rateLimitPerSec = parsePositiveInt(
    "LOAD_TEST_RATE_PER_SEC",
    dryRun ? 100 : 3,
    dryRun ? 10_000 : 50
  );
  const timelockSeconds = parsePositiveInt("LOAD_TEST_TIMELOCK_SEC", 600, 86_400);

  if (!dryRun) {
    const hasRpc = !!(process.env.SEPOLIA_RPC_URL || process.env.INFURA_API_KEY);
    if (!hasRpc) {
      throw new Error(
        "Live mode requires SEPOLIA_RPC_URL or INFURA_API_KEY.\n" +
          "Unset LOAD_TEST_LIVE to use dry-run mode instead."
      );
    }
    if (!process.env.RESOLVER_ETH_PRIVATE_KEY) {
      throw new Error(
        "Live mode requires RESOLVER_ETH_PRIVATE_KEY.\n" +
          "Unset LOAD_TEST_LIVE to use dry-run mode instead."
      );
    }
    if (rateLimitPerSec > 5) {
      process.stderr.write(
        `[WARN] LOAD_TEST_RATE_PER_SEC=${rateLimitPerSec} in live mode — ` +
          "Sepolia/Stellar testnet RPC providers may rate-limit above 3/sec.\n"
      );
    }
    if (!allowLarge && orders > 100) {
      throw new Error(
        `Live mode with ${orders} orders requires LOAD_TEST_ALLOW_LARGE=true (testnet cost safeguard).`
      );
    }
  }

  const sepoliaRpcUrl =
    process.env.SEPOLIA_RPC_URL ??
    (process.env.INFURA_API_KEY
      ? `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
      : null);

  return {
    dryRun,
    seed: process.env.LOAD_TEST_SEED ?? "oversync-soak-2026",
    orders,
    concurrency,
    rateLimitPerSec,
    timelockSeconds,
    outputDir: process.env.LOAD_TEST_OUTPUT_DIR ?? "reports",
    sepoliaRpcUrl,
    sorobanRpcUrl:
      process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  };
}
