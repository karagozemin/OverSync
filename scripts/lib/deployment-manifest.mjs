/**
 * Read-only validation of Ethereum + Stellar deployment manifests (issue #234).
 *
 * This module never touches the filesystem or the network: it takes an already
 * parsed manifest and returns the list of fields that are wrong, so the same
 * rules can be exercised by tests and by the CLI in `validate-deployments.mjs`.
 *
 * Every failure is reported against the JSON path of the offending field rather
 * than as a single "manifest is invalid", because a manifest is edited by hand
 * after a deploy and the useful answer is which identifier is missing.
 */

export const NETWORKS = new Set(["testnet", "mainnet"]);

export const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
export const STELLAR_ACCOUNT_ID = /^G[A-Z2-7]{55}$/;
export const SOROBAN_CONTRACT_ID = /^C[A-Z2-7]{55}$/;
export const HEX_64 = /^[a-fA-F0-9]{64}$/;

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** Contracts every manifest must pin, per chain. */
export const REQUIRED_ETHEREUM_CONTRACTS = ["HTLCEscrow", "ResolverRegistry"];
export const REQUIRED_STELLAR_CONTRACTS = ["HTLC", "ResolverRegistry"];

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

class Validator {
  constructor() {
    this.errors = [];
  }

  fail(path, message) {
    this.errors.push({ path, message });
    return null;
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
      return this.fail(path, `must be a non-empty string, got ${valueType(value)}`);
    }
    return value;
  }

  optionalString(value, path) {
    if (value == null) return null;
    return this.string(value, path);
  }

  number(value, path) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return this.fail(path, `must be a finite number, got ${valueType(value)}`);
    }
    return value;
  }

  match(value, path, pattern, label) {
    const string = this.string(value, path);
    if (string != null && !pattern.test(string)) {
      return this.fail(path, `must be a valid ${label}, got ${JSON.stringify(string)}`);
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

function validateEthereum(v, ethereum, network) {
  if (!v.object(ethereum, "$.ethereum")) return;

  const chainId = v.number(ethereum.chainId, "$.ethereum.chainId");
  const name = v.string(ethereum.name, "$.ethereum.name");
  v.url(ethereum.rpcUrl, "$.ethereum.rpcUrl");
  v.date(ethereum.deployedAt, "$.ethereum.deployedAt");
  v.match(ethereum.deployer, "$.ethereum.deployer", EVM_ADDRESS, "EVM address");

  // A field that already failed its type check is not reported a second time
  // for its network-specific value: one error per field keeps the output a
  // checklist of what to fix.
  if (network === "testnet") {
    if (chainId !== null && chainId !== 11155111) {
      v.fail("$.ethereum.chainId", "must be 11155111 for testnet deployments");
    }
    if (name !== null && name !== "Sepolia") {
      v.fail("$.ethereum.name", 'must be "Sepolia" for testnet deployments');
    }
  }
  if (network === "mainnet" && chainId !== null && chainId !== 1) {
    v.fail("$.ethereum.chainId", "must be 1 for mainnet deployments");
  }

  if (!v.object(ethereum.contracts, "$.ethereum.contracts")) return;
  for (const contract of REQUIRED_ETHEREUM_CONTRACTS) {
    v.match(
      ethereum.contracts[contract],
      `$.ethereum.contracts.${contract}`,
      EVM_ADDRESS,
      "EVM address",
    );
  }
}

/**
 * The staking asset is an identifier the bridge cannot run without: it names
 * the Soroban asset contract resolvers post stake in, and the minimum stake
 * denominated in that asset. It used to be validated only when present, so a
 * manifest that omitted the whole block passed while naming no asset at all.
 */
function validateStellarAsset(v, stellar) {
  const path = "$.stellar.resolverRegistryConfig";
  if (stellar.resolverRegistryConfig == null) {
    v.fail(path, "is required: it names the staking asset and minimum stake");
    return;
  }
  if (!v.object(stellar.resolverRegistryConfig, path)) return;

  const cfg = stellar.resolverRegistryConfig;
  v.match(cfg.admin, `${path}.admin`, STELLAR_ACCOUNT_ID, "Stellar account ID");
  v.match(cfg.stakeAsset, `${path}.stakeAsset`, SOROBAN_CONTRACT_ID, "Soroban contract ID");
  v.optionalString(cfg.stakeAssetName, `${path}.stakeAssetName`);
  v.match(
    cfg.slashBeneficiary,
    `${path}.slashBeneficiary`,
    STELLAR_ACCOUNT_ID,
    "Stellar account ID",
  );

  const minStake = v.string(cfg.minStake, `${path}.minStake`);
  if (minStake != null && !/^[0-9]+$/.test(minStake)) {
    v.fail(`${path}.minStake`, "must be a base-unit integer string");
  }

  const minStakeXLM = v.string(cfg.minStakeXLM, `${path}.minStakeXLM`);
  if (minStakeXLM != null && !/^[0-9]+(\.[0-9]+)?$/.test(minStakeXLM)) {
    v.fail(`${path}.minStakeXLM`, "must be a decimal string");
  }
}

function validateStellar(v, stellar, network) {
  if (!v.object(stellar, "$.stellar")) return;

  const passphrase = v.string(stellar.passphrase, "$.stellar.passphrase");
  v.url(stellar.horizon, "$.stellar.horizon");
  v.url(stellar.rpc, "$.stellar.rpc");
  v.date(stellar.deployedAt, "$.stellar.deployedAt");
  v.match(stellar.deployer, "$.stellar.deployer", STELLAR_ACCOUNT_ID, "Stellar account ID");

  if (network === "testnet" && passphrase !== null && passphrase !== TESTNET_PASSPHRASE) {
    v.fail("$.stellar.passphrase", `must be ${JSON.stringify(TESTNET_PASSPHRASE)} for testnet deployments`);
  }
  if (network === "mainnet" && passphrase !== null && passphrase !== MAINNET_PASSPHRASE) {
    v.fail("$.stellar.passphrase", `must be ${JSON.stringify(MAINNET_PASSPHRASE)} for mainnet deployments`);
  }

  if (v.object(stellar.contracts, "$.stellar.contracts")) {
    for (const contract of REQUIRED_STELLAR_CONTRACTS) {
      v.match(
        stellar.contracts[contract],
        `$.stellar.contracts.${contract}`,
        SOROBAN_CONTRACT_ID,
        "Soroban contract ID",
      );
    }
  }

  if (
    stellar.deployTransactions != null &&
    v.object(stellar.deployTransactions, "$.stellar.deployTransactions")
  ) {
    for (const [key, txHash] of Object.entries(stellar.deployTransactions)) {
      v.match(
        txHash,
        `$.stellar.deployTransactions.${key}`,
        HEX_64,
        "64-character hex transaction hash",
      );
    }
  }

  validateStellarAsset(v, stellar);
}

/**
 * Validates a parsed manifest.
 *
 * `expectedNetwork` is the network the manifest's file name claims; when given,
 * a mismatch with `$.network` is reported, since a testnet manifest saved as
 * mainnet is the kind of error that only shows up at deploy time.
 *
 * Returns `{ ok, errors }` with `errors` as `{ path, message }` pairs.
 */
export function validateDeploymentManifest(manifest, options = {}) {
  const { expectedNetwork } = options;
  const v = new Validator();

  if (!v.object(manifest, "$")) {
    return { ok: false, errors: v.errors };
  }

  const network = v.string(manifest.network, "$.network");
  if (network != null && !NETWORKS.has(network)) {
    v.fail(
      "$.network",
      `must be one of ${Array.from(NETWORKS).join(", ")}, got ${JSON.stringify(network)}`,
    );
  }

  if (network != null && NETWORKS.has(network) && expectedNetwork && expectedNetwork !== network) {
    v.fail("$.network", `must match file name deployments.${network}.json`);
  }

  const resolvedNetwork = network != null && NETWORKS.has(network) ? network : undefined;
  validateEthereum(v, manifest.ethereum, resolvedNetwork);
  validateStellar(v, manifest.stellar, resolvedNetwork);

  return { ok: v.errors.length === 0, errors: v.errors };
}

/** Renders one field-level error as `file:path message`. */
export function formatManifestError(error, fileName) {
  return `${fileName}:${error.path} ${error.message}`;
}
