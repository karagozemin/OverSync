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

const MAINNET_ETH_RPC_PATTERNS = [
  /mainnet\.infura\.io/i,
  /eth\.mainnet/i,
  /mainnet\.alchemyapi\.io/i,
  /mainnet\.alchemy\.com/i,
  /mainnet\.rpc\.gnosis\.io/i,
  /mainnet\.rpc\.ankr\.com/i,
  /cloudflare-eth\.com/i,
  /rpc\.ankr\.com\/eth$/i,
  /eth-mainnet\.public\.blastapi\.io/i,
  /mainnet\.era\.zksync\.io/i,
];

const MAINNET_STELLAR_RPC_PATTERNS = [
  /soroban-mainnet/i,
  /mainnet\.stellar\.org/i,
  /rpc\.mainnet\.stellar/i,
  /mainnet\.sorobanrpc\.com/i,
  /horizon\.stellar\.org/i,
];

const MAINNET_STELLAR_PASSPHRASES = [
  "public global stellar network ; september 2015",
];

function isMainnetEthRpc(url: string): boolean {
  return MAINNET_ETH_RPC_PATTERNS.some((pattern) => pattern.test(url));
}

function isMainnetStellarRpc(url: string): boolean {
  return MAINNET_STELLAR_RPC_PATTERNS.some((pattern) => pattern.test(url));
}

function isMainnetStellarPassphrase(passphrase: string): boolean {
  const normalized = passphrase.trim().toLowerCase();
  return MAINNET_STELLAR_PASSPHRASES.includes(normalized);
}

function redactUrlUserinfo(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function validateNotMainnet(config: LoadTestConfig): void {
  if (config.sepoliaRpcUrl && isMainnetEthRpc(config.sepoliaRpcUrl)) {
    throw new Error(
      `Refusing to run: SEPOLIA_RPC_URL points to an Ethereum mainnet endpoint (${redactUrlUserinfo(config.sepoliaRpcUrl)}). ` +
        "Use a Sepolia/testnet RPC URL."
    );
  }
  if (config.sorobanRpcUrl && isMainnetStellarRpc(config.sorobanRpcUrl)) {
    throw new Error(
      `Refusing to run: SOROBAN_RPC_URL points to a Stellar mainnet endpoint (${redactUrlUserinfo(config.sorobanRpcUrl)}). ` +
        "Use a testnet/futurenet RPC URL."
    );
  }
  const stellarPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE;
  if (stellarPassphrase && isMainnetStellarPassphrase(stellarPassphrase)) {
    throw new Error(
      "Refusing to run: STELLAR_NETWORK_PASSPHRASE is set to the mainnet passphrase. " +
        "Use the testnet passphrase: 'Test SDF Network ; September 2015'."
    );
  }
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

  const config: LoadTestConfig = {
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

  validateNotMainnet(config);

  return config;
}
