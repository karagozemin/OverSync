import type { ResolverConfig } from "../config.js";

/**
 * Validate basic resolver config sanity. Returns a list of error strings
 * (empty = valid). This does NOT check connectivity — only that values
 * are present and structurally sound.
 *
 * In dry-run mode, private keys are NOT required. In live mode they are.
 */
export function validateResolverConfig(
  cfg: ResolverConfig,
  dryRun: boolean
): string[] {
  const errs: string[] = [];

  if (cfg.network !== "testnet" && cfg.network !== "mainnet") {
    errs.push(`Invalid network: ${cfg.network}`);
  }

  if (!cfg.ethereum.htlcEscrow) {
    errs.push(
      `ETH_HTLC_ESCROW contract address is not configured (set ETH_HTLC_ESCROW_TESTNET or ETH_HTLC_ESCROW_MAINNET)`
    );
  }

  if (!cfg.soroban.htlc) {
    errs.push(
      `SOROBAN_HTLC contract id is not configured (set SOROBAN_HTLC_TESTNET or SOROBAN_HTLC_MAINNET)`
    );
  }

  if (!cfg.ethereum.rpcUrl) {
    errs.push("Ethereum RPC URL is not configured");
  }

  if (!cfg.soroban.rpcUrl) {
    errs.push("Soroban RPC URL is not configured");
  }

  // Private keys are only required when NOT in dry-run.
  if (!dryRun) {
    if (!cfg.ethereum.resolverPrivateKey) {
      errs.push("RESOLVER_ETH_PRIVATE_KEY is required when dry-run is disabled");
    }
    if (!cfg.soroban.resolverSecret) {
      errs.push("RESOLVER_STELLAR_SECRET is required when dry-run is disabled");
    }
  }

  return errs;
}

/**
 * Validate the computed destination parameters for sanity.
 */
export function validateDestinationParams(
  amount: bigint,
  safetyDeposit: bigint,
  timelockSeconds: bigint
): string[] {
  const errs: string[] = [];

  if (amount <= 0n) {
    errs.push("Destination amount must be > 0");
  }

  if (safetyDeposit < 0n) {
    errs.push("Safety deposit must be >= 0");
  }

  // Mirror the on-chain MIN_TIMELOCK (300s) / MAX_TIMELOCK (24h) bounds.
  if (timelockSeconds < 300n) {
    errs.push(`Timelock (${timelockSeconds}s) is below minimum (300s)`);
  }
  if (timelockSeconds > 86400n) {
    errs.push(`Timelock (${timelockSeconds}s) exceeds maximum (86400s)`);
  }

  return errs;
}
