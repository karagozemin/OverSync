import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEPLOYMENT_FILE = /^deployments\.[a-z0-9-]+\.json$/i;
const NETWORKS = new Set(["testnet", "mainnet"]);
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;
const SOROBAN_CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const HEX_64 = /^[a-fA-F0-9]{64}$/;

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

class Validator {
  constructor(file) {
    this.file = file;
    this.errors = [];
  }

  fail(path, message) {
    this.errors.push(`${this.file}:${path} ${message}`);
  }

  object(value, path) {
    if (valueType(value) !== "object") {
      this.fail(path, `must be an object, got ${valueType(value)}`);
      return false;
    }
    return true;
  }

  string(value, path) {
    if (typeof value !== "string" || value.trim() === "") {
      this.fail(path, `must be a non-empty string, got ${valueType(value)}`);
      return null;
    }
    return value;
  }

  optionalString(value, path) {
    if (value == null) return null;
    return this.string(value, path);
  }

  number(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.fail(path, `must be a finite number, got ${valueType(value)}`);
      return null;
    }
    return value;
  }

  match(value, path, pattern, label) {
    const string = this.string(value, path);
    if (string != null && !pattern.test(string)) {
      this.fail(path, `must be a valid ${label}, got ${JSON.stringify(string)}`);
      return null;
    }
    return string;
  }

  url(value, path) {
    const string = this.string(value, path);
    if (string == null) return null;
    try {
      const parsed = new URL(string);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        this.fail(path, "must use http or https");
      }
    } catch {
      this.fail(path, `must be a valid URL, got ${JSON.stringify(string)}`);
    }
    return string;
  }

  date(value, path) {
    const string = this.string(value, path);
    if (string != null && !/^\d{4}-\d{2}-\d{2}$/.test(string)) {
      this.fail(path, `must be YYYY-MM-DD, got ${JSON.stringify(string)}`);
    }
    return string;
  }
}

async function deploymentFiles() {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && DEPLOYMENT_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function validateEthereum(v, ethereum, network) {
  if (!v.object(ethereum, "$.ethereum")) return;
  const chainId = v.number(ethereum.chainId, "$.ethereum.chainId");
  const name = v.string(ethereum.name, "$.ethereum.name");
  v.url(ethereum.rpcUrl, "$.ethereum.rpcUrl");
  v.date(ethereum.deployedAt, "$.ethereum.deployedAt");
  v.match(ethereum.deployer, "$.ethereum.deployer", EVM_ADDRESS, "EVM address");

  if (network === "testnet") {
    if (chainId !== 11155111) v.fail("$.ethereum.chainId", "must be 11155111 for testnet deployments");
    if (name !== "Sepolia") v.fail("$.ethereum.name", 'must be "Sepolia" for testnet deployments');
  }
  if (network === "mainnet") {
    if (chainId !== 1) v.fail("$.ethereum.chainId", "must be 1 for mainnet deployments");
  }

  if (!v.object(ethereum.contracts, "$.ethereum.contracts")) return;
  v.match(ethereum.contracts.HTLCEscrow, "$.ethereum.contracts.HTLCEscrow", EVM_ADDRESS, "EVM address");
  v.match(
    ethereum.contracts.ResolverRegistry,
    "$.ethereum.contracts.ResolverRegistry",
    EVM_ADDRESS,
    "EVM address"
  );
}

function validateStellar(v, stellar, network) {
  if (!v.object(stellar, "$.stellar")) return;
  v.string(stellar.passphrase, "$.stellar.passphrase");
  v.url(stellar.horizon, "$.stellar.horizon");
  v.url(stellar.rpc, "$.stellar.rpc");
  v.date(stellar.deployedAt, "$.stellar.deployedAt");
  v.match(stellar.deployer, "$.stellar.deployer", STELLAR_ACCOUNT_ID, "Stellar account ID");

  if (network === "testnet" && stellar.passphrase !== "Test SDF Network ; September 2015") {
    v.fail("$.stellar.passphrase", 'must be "Test SDF Network ; September 2015" for testnet deployments');
  }
  if (network === "mainnet" && stellar.passphrase !== "Public Global Stellar Network ; September 2015") {
    v.fail("$.stellar.passphrase", 'must be "Public Global Stellar Network ; September 2015" for mainnet deployments');
  }

  if (!v.object(stellar.contracts, "$.stellar.contracts")) return;
  v.match(stellar.contracts.HTLC, "$.stellar.contracts.HTLC", SOROBAN_CONTRACT_ID, "Soroban contract ID");
  v.match(
    stellar.contracts.ResolverRegistry,
    "$.stellar.contracts.ResolverRegistry",
    SOROBAN_CONTRACT_ID,
    "Soroban contract ID"
  );

  if (stellar.deployTransactions != null && v.object(stellar.deployTransactions, "$.stellar.deployTransactions")) {
    for (const [key, txHash] of Object.entries(stellar.deployTransactions)) {
      v.match(txHash, `$.stellar.deployTransactions.${key}`, HEX_64, "64-character hex transaction hash");
    }
  }

  if (stellar.resolverRegistryConfig != null && v.object(stellar.resolverRegistryConfig, "$.stellar.resolverRegistryConfig")) {
    const cfg = stellar.resolverRegistryConfig;
    v.match(cfg.admin, "$.stellar.resolverRegistryConfig.admin", STELLAR_ACCOUNT_ID, "Stellar account ID");
    v.match(cfg.stakeAsset, "$.stellar.resolverRegistryConfig.stakeAsset", SOROBAN_CONTRACT_ID, "Soroban contract ID");
    v.optionalString(cfg.stakeAssetName, "$.stellar.resolverRegistryConfig.stakeAssetName");
    v.match(
      cfg.slashBeneficiary,
      "$.stellar.resolverRegistryConfig.slashBeneficiary",
      STELLAR_ACCOUNT_ID,
      "Stellar account ID"
    );
    const minStake = v.string(cfg.minStake, "$.stellar.resolverRegistryConfig.minStake");
    if (minStake != null && !/^[0-9]+$/.test(minStake)) {
      v.fail("$.stellar.resolverRegistryConfig.minStake", "must be a base-unit integer string");
    }
    const minStakeXLM = v.string(cfg.minStakeXLM, "$.stellar.resolverRegistryConfig.minStakeXLM");
    if (minStakeXLM != null && !/^[0-9]+(\.[0-9]+)?$/.test(minStakeXLM)) {
      v.fail("$.stellar.resolverRegistryConfig.minStakeXLM", "must be a decimal string");
    }
  }
}

async function validateFile(fileName) {
  const v = new Validator(fileName);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(repoRoot, fileName), "utf8"));
  } catch (err) {
    return [`${fileName}:$ must be valid JSON: ${err.message}`];
  }

  if (!v.object(parsed, "$")) return v.errors;
  const network = v.string(parsed.network, "$.network");
  if (network != null && !NETWORKS.has(network)) {
    v.fail("$.network", `must be one of ${Array.from(NETWORKS).join(", ")}, got ${JSON.stringify(network)}`);
  }

  const fileNetwork = basename(fileName, ".json").replace(/^deployments\./, "");
  if (network != null && NETWORKS.has(network) && fileNetwork !== network) {
    v.fail("$.network", `must match file name deployments.${network}.json`);
  }

  validateEthereum(v, parsed.ethereum, network);
  validateStellar(v, parsed.stellar, network);
  return v.errors;
}

async function main() {
  const files = await deploymentFiles();
  if (files.length === 0) {
    console.error("No deployment files found. Expected files like deployments.testnet.json.");
    process.exitCode = 1;
    return;
  }

  const errors = [];
  for (const file of files) {
    errors.push(...(await validateFile(file)));
  }

  if (errors.length > 0) {
    console.error("Deployment validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${files.length} deployment file(s): ${files.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
