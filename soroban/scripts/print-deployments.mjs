#!/usr/bin/env node
/**
 * soroban/scripts/print-deployments.mjs
 *
 * Prints Soroban contract deployment metadata in a format suitable for
 * copy-pasting into SCF evidence notes or reviewer communications.
 *
 * Read-only: no private key is required, no contract writes are performed.
 * Missing RPC / config produces a clear non-fatal warning and the script
 * exits 0 so CI pipelines are not broken.
 *
 * Usage:
 *   node soroban/scripts/print-deployments.mjs [testnet|mainnet]
 *   pnpm soroban:verify
 *   pnpm soroban:verify:mainnet
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";

function ok(msg)   { console.log(`${GREEN}✔${RESET}  ${msg}`); }
function warn(msg) { console.log(`${YELLOW}⚠${RESET}  ${msg}`); }
function fail(msg) { console.log(`${RED}✘${RESET}  ${msg}`); }
function info(msg) { console.log(`${CYAN}ℹ${RESET}  ${msg}`); }
function dim(msg)  { console.log(`${DIM}${msg}${RESET}`); }
function hr()      { console.log(`${DIM}${"\u2500".repeat(72)}${RESET}`); }

function section(title) {
  console.log();
  console.log(`${BOLD}${title}${RESET}`);
  hr();
}

async function probeRpc(rpcUrl) {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 6_000);
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestLedger",
        params: {},
      }),
      signal: ctrl.signal,
    });
    clearTimeout(id);
    if (!res.ok) return "rpc-unavailable";
    const json = await res.json();
    if (json?.result?.sequence) return "reachable";
    return "rpc-unavailable";
  } catch {
    return "rpc-unavailable";
  }
}

const CONTRACT_META = {
  HTLC: {
    role: "HTLC (Hash-Time-Lock Contract)",
    description:
      "Locks XLM/tokens on Stellar; settles on sha256 preimage reveal; " +
      "refunds permissionlessly after timelock expiry.",
    sourceFile: "soroban/contracts/htlc/src/lib.rs",
  },
  ResolverRegistry: {
    role: "Resolver Registry",
    description:
      "On-chain registry of staked resolvers. Resolvers stake XLM to fill " +
      "orders; misbehaviour is slashable.",
    sourceFile: "soroban/contracts/resolver-registry/src/lib.rs",
  },
};

function stellarExpertLink(network, contractId) {
  const net = network === "mainnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/contract/${contractId}`;
}

async function main() {
  const network = process.argv[2] ?? "testnet";

  if (network !== "testnet" && network !== "mainnet") {
    fail(`Unknown network "${network}". Use "testnet" or "mainnet".`);
    process.exit(1);
  }

  console.log();
  console.log(`${BOLD}OverSync \u2014 Soroban Deployment Verification${RESET}`);
  console.log(
    `${DIM}Network: ${network}   Generated: ${new Date().toISOString()}${RESET}`
  );
  hr();

  const deploymentsPath = resolve(REPO_ROOT, `deployments.${network}.json`);

  if (!existsSync(deploymentsPath)) {
    warn(`deployments.${network}.json not found at ${deploymentsPath}`);
    warn(
      "Run soroban/scripts/deploy.sh to create it, or set contract IDs manually."
    );
    console.log();
    process.exit(0);
  }

  let deployments;
  try {
    deployments = JSON.parse(readFileSync(deploymentsPath, "utf8"));
  } catch (e) {
    fail(`Could not parse ${deploymentsPath}: ${e.message}`);
    process.exit(1);
  }

  const stellar = deployments.stellar ?? {};
  const rpcUrl = stellar.rpc ?? (
    network === "mainnet"
      ? "https://mainnet.sorobanrpc.com"
      : "https://soroban-testnet.stellar.org"
  );
  const horizon = stellar.horizon ?? (
    network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org"
  );
  const passphrase = stellar.passphrase ?? (
    network === "mainnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015"
  );
  const deployedAt = stellar.deployedAt ?? deployments.deployedAt ?? "unknown";
  const deployer = stellar.deployer ?? deployments.deployer ?? "unknown";

  const contractMap = {
    HTLC: stellar.contracts?.HTLC ?? null,
    ResolverRegistry: stellar.contracts?.ResolverRegistry ?? null,
  };

  section("Network Configuration");
  info(`Network mode   : ${network}`);
  info(`RPC URL        : ${rpcUrl}`);
  info(`Horizon URL    : ${horizon}`);
  info(`Passphrase     : ${passphrase}`);
  info(`Deployed at    : ${deployedAt}`);
  info(`Deployer       : ${deployer}`);

  section("RPC Reachability");
  info(`Probing ${rpcUrl} ...`);
  const rpcStatus = await probeRpc(rpcUrl);
  if (rpcStatus === "reachable") {
    ok("RPC node is reachable");
  } else {
    warn("RPC node is not reachable \u2014 contract status checks will be skipped.");
    warn(
      "This is non-fatal: contract IDs and explorer links are still shown below."
    );
  }

  section("Soroban Contract Deployments");

  const evidenceLines = [];

  for (const [key, meta] of Object.entries(CONTRACT_META)) {
    const contractId = contractMap[key];

    console.log();
    console.log(`${BOLD}${meta.role}${RESET}`);
    dim(`  ${meta.description}`);
    console.log();

    if (!contractId) {
      warn(
        `  Contract ID not found in deployments.${network}.json (key: "${key}")`
      );
      info(`  Source file : ${meta.sourceFile}`);
      evidenceLines.push(`${meta.role}: NOT CONFIGURED`);
      continue;
    }

    const expertLink = stellarExpertLink(network, contractId);

    info(`  Contract ID   : ${contractId}`);
    info(`  Stellar Expert: ${expertLink}`);
    info(`  Source file   : ${meta.sourceFile}`);

    evidenceLines.push(
      `${meta.role}`,
      `  Contract ID : ${contractId}`,
      `  Explorer    : ${expertLink}`,
      `  Source      : ${meta.sourceFile}`,
      ""
    );
  }

  const deployTxs = stellar.deployTransactions;
  if (deployTxs && Object.keys(deployTxs).length > 0) {
    section("Deploy Transactions (Stellar Expert links)");
    for (const [label, txHash] of Object.entries(deployTxs)) {
      if (!txHash) continue;
      const net = network === "mainnet" ? "public" : "testnet";
      const txLink = `https://stellar.expert/explorer/${net}/tx/${txHash}`;
      info(`  ${label.padEnd(32)}: ${txLink}`);
      evidenceLines.push(`Deploy tx (${label}): ${txLink}`);
    }
  }

  const regCfg = stellar.resolverRegistryConfig;
  if (regCfg) {
    section("Resolver Registry On-Chain Configuration");
    info(`  Admin              : ${regCfg.admin ?? "unknown"}`);
    info(`  Stake asset        : ${regCfg.stakeAssetName ?? regCfg.stakeAsset ?? "unknown"}`);
    info(`  Min stake          : ${regCfg.minStakeXLM ? regCfg.minStakeXLM + " XLM" : (regCfg.minStake ?? "unknown") + " stroops"}`);
    info(`  Slash beneficiary  : ${regCfg.slashBeneficiary ?? "unknown"}`);
  }

  const eth = deployments.ethereum;
  if (eth?.contracts) {
    section("Ethereum Companion Contracts (Sepolia)");
    for (const [name, addr] of Object.entries(eth.contracts)) {
      if (!addr) continue;
      const ethLink = `https://sepolia.etherscan.io/address/${addr}`;
      info(`  ${name.padEnd(20)}: ${addr}`);
      info(`  ${"".padEnd(20)}  ${ethLink}`);
    }
  }

  section("SCF Evidence Copy-Paste Block");
  dim("Copy everything between the dashes into SCF evidence notes or reviewer emails.");
  console.log();
  console.log("\u2500".repeat(72));
  console.log(
    `OverSync Soroban Deployment \u2014 ${network} \u2014 ${new Date().toISOString()}`
  );
  console.log();
  console.log(`Network     : ${network}`);
  console.log(`RPC         : ${rpcUrl}`);
  console.log(`Deployed at : ${deployedAt}`);
  console.log();
  for (const line of evidenceLines) {
    console.log(line);
  }
  if (eth?.contracts) {
    console.log("Ethereum (Sepolia):");
    for (const [name, addr] of Object.entries(eth.contracts)) {
      if (!addr) continue;
      console.log(`  ${name}: ${addr}`);
      console.log(`  https://sepolia.etherscan.io/address/${addr}`);
    }
  }
  console.log("\u2500".repeat(72));
  console.log();
  ok("Done. No contract writes were performed.");
  console.log();
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
