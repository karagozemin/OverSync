import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  formatManifestError,
  validateDeploymentManifest,
} from "./deployment-manifest.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** A complete, valid testnet manifest. Every test starts from this shape. */
function validManifest() {
  return {
    network: "testnet",
    ethereum: {
      chainId: 11155111,
      name: "Sepolia",
      rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
      contracts: {
        HTLCEscrow: "0xb352339BEb146f2699d28D736700B953988bB178",
        ResolverRegistry: "0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99",
      },
      deployedAt: "2026-05-14",
      deployer: "0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c",
    },
    stellar: {
      passphrase: "Test SDF Network ; September 2015",
      horizon: "https://horizon-testnet.stellar.org",
      rpc: "https://soroban-testnet.stellar.org",
      contracts: {
        HTLC: "CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK",
        ResolverRegistry: "CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF",
      },
      deployedAt: "2026-05-14",
      deployer: "GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL",
      resolverRegistryConfig: {
        admin: "GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL",
        stakeAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        stakeAssetName: "native XLM SAC",
        minStake: "1000000000",
        minStakeXLM: "100",
        slashBeneficiary: "GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL",
      },
    },
  };
}

/** Applies `mutate` to a valid manifest and returns the reported error paths. */
function errorPaths(mutate, options) {
  const manifest = validManifest();
  mutate(manifest);
  return validateDeploymentManifest(manifest, options).errors.map((error) => error.path);
}

describe("validateDeploymentManifest — valid manifests", () => {
  it("accepts a complete testnet manifest", () => {
    const result = validateDeploymentManifest(validManifest(), { expectedNetwork: "testnet" });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it("accepts the manifest shipped in the repository", () => {
    const shipped = JSON.parse(
      readFileSync(resolve(repoRoot, "deployments.testnet.json"), "utf8"),
    );
    const result = validateDeploymentManifest(shipped, { expectedNetwork: "testnet" });
    assert.deepEqual(result.errors, []);
  });

  it("accepts optional blocks being absent", () => {
    const manifest = validManifest();
    delete manifest.stellar.deployTransactions;
    delete manifest.stellar.resolverRegistryConfig.stakeAssetName;
    assert.equal(validateDeploymentManifest(manifest).ok, true);
  });
});

describe("validateDeploymentManifest — missing network identifiers", () => {
  it("rejects a missing network", () => {
    assert.deepEqual(errorPaths((m) => delete m.network), ["$.network"]);
  });

  it("rejects an unknown network", () => {
    assert.deepEqual(errorPaths((m) => (m.network = "devnet")), ["$.network"]);
  });

  it("rejects a network that disagrees with the file name", () => {
    const paths = errorPaths(() => {}, { expectedNetwork: "mainnet" });
    assert.deepEqual(paths, ["$.network"]);
  });

  it("rejects a missing Ethereum chain id", () => {
    assert.deepEqual(errorPaths((m) => delete m.ethereum.chainId), ["$.ethereum.chainId"]);
  });

  it("reports a field once, not twice", () => {
    // A missing chain id fails its type check; it must not also be reported for
    // disagreeing with the testnet chain id.
    assert.deepEqual(errorPaths((m) => delete m.ethereum.chainId), ["$.ethereum.chainId"]);
    assert.deepEqual(errorPaths((m) => (m.ethereum.chainId = 1)), ["$.ethereum.chainId"]);
  });

  it("rejects a missing Stellar network passphrase", () => {
    assert.deepEqual(errorPaths((m) => delete m.stellar.passphrase), [
      "$.stellar.passphrase",
    ]);
  });

  it("rejects an entire chain section being absent", () => {
    assert.deepEqual(errorPaths((m) => delete m.ethereum), ["$.ethereum"]);
    assert.deepEqual(errorPaths((m) => delete m.stellar), ["$.stellar"]);
  });
});

describe("validateDeploymentManifest — missing contract identifiers", () => {
  it("rejects each missing Ethereum contract by name", () => {
    assert.deepEqual(errorPaths((m) => delete m.ethereum.contracts.HTLCEscrow), [
      "$.ethereum.contracts.HTLCEscrow",
    ]);
    assert.deepEqual(errorPaths((m) => delete m.ethereum.contracts.ResolverRegistry), [
      "$.ethereum.contracts.ResolverRegistry",
    ]);
  });

  it("rejects each missing Stellar contract by name", () => {
    assert.deepEqual(errorPaths((m) => delete m.stellar.contracts.HTLC), [
      "$.stellar.contracts.HTLC",
    ]);
    assert.deepEqual(errorPaths((m) => delete m.stellar.contracts.ResolverRegistry), [
      "$.stellar.contracts.ResolverRegistry",
    ]);
  });

  it("rejects a missing contracts block", () => {
    assert.deepEqual(errorPaths((m) => delete m.ethereum.contracts), ["$.ethereum.contracts"]);
  });

  it("rejects addresses from the wrong chain", () => {
    // A Soroban contract id where an EVM address belongs, and the reverse.
    assert.deepEqual(
      errorPaths((m) => {
        m.ethereum.contracts.HTLCEscrow = "CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK";
      }),
      ["$.ethereum.contracts.HTLCEscrow"],
    );
    assert.deepEqual(
      errorPaths((m) => {
        m.stellar.contracts.HTLC = "0xb352339BEb146f2699d28D736700B953988bB178";
      }),
      ["$.stellar.contracts.HTLC"],
    );
  });

  it("rejects a Stellar account id where a contract id belongs", () => {
    assert.deepEqual(
      errorPaths((m) => {
        m.stellar.contracts.HTLC = "GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL";
      }),
      ["$.stellar.contracts.HTLC"],
    );
  });
});

describe("validateDeploymentManifest — missing asset identifiers", () => {
  it("rejects a manifest that names no staking asset at all", () => {
    // Previously the whole block was optional, so a manifest missing every
    // asset identifier validated cleanly.
    assert.deepEqual(errorPaths((m) => delete m.stellar.resolverRegistryConfig), [
      "$.stellar.resolverRegistryConfig",
    ]);
  });

  it("rejects a missing stake asset contract", () => {
    assert.deepEqual(
      errorPaths((m) => delete m.stellar.resolverRegistryConfig.stakeAsset),
      ["$.stellar.resolverRegistryConfig.stakeAsset"],
    );
  });

  it("rejects a missing minimum stake", () => {
    assert.deepEqual(errorPaths((m) => delete m.stellar.resolverRegistryConfig.minStake), [
      "$.stellar.resolverRegistryConfig.minStake",
    ]);
    assert.deepEqual(errorPaths((m) => delete m.stellar.resolverRegistryConfig.minStakeXLM), [
      "$.stellar.resolverRegistryConfig.minStakeXLM",
    ]);
  });

  it("rejects a non-integer base-unit minimum stake", () => {
    assert.deepEqual(
      errorPaths((m) => (m.stellar.resolverRegistryConfig.minStake = "100.5")),
      ["$.stellar.resolverRegistryConfig.minStake"],
    );
  });

  it("rejects missing admin and slash beneficiary accounts", () => {
    assert.deepEqual(errorPaths((m) => delete m.stellar.resolverRegistryConfig.admin), [
      "$.stellar.resolverRegistryConfig.admin",
    ]);
    assert.deepEqual(
      errorPaths((m) => delete m.stellar.resolverRegistryConfig.slashBeneficiary),
      ["$.stellar.resolverRegistryConfig.slashBeneficiary"],
    );
  });
});

describe("validateDeploymentManifest — malformed values", () => {
  it("rejects a non-http endpoint", () => {
    assert.deepEqual(errorPaths((m) => (m.stellar.horizon = "ftp://horizon.example")), [
      "$.stellar.horizon",
    ]);
  });

  it("rejects a malformed deployment date", () => {
    assert.deepEqual(errorPaths((m) => (m.ethereum.deployedAt = "14-05-2026")), [
      "$.ethereum.deployedAt",
    ]);
  });

  it("rejects a malformed deploy transaction hash", () => {
    assert.deepEqual(
      errorPaths((m) => {
        m.stellar.deployTransactions = { HTLC: "not-a-hash" };
      }),
      ["$.stellar.deployTransactions.HTLC"],
    );
  });

  it("rejects a manifest that is not an object", () => {
    assert.deepEqual(validateDeploymentManifest(null).errors, [
      { path: "$", message: "must be an object, got null" },
    ]);
    assert.equal(validateDeploymentManifest([]).errors[0].path, "$");
  });
});

describe("validateDeploymentManifest — reporting", () => {
  it("reports every bad field, not just the first", () => {
    const paths = errorPaths((m) => {
      delete m.ethereum.contracts.HTLCEscrow;
      delete m.stellar.contracts.HTLC;
      delete m.stellar.resolverRegistryConfig;
    });

    assert.deepEqual(paths, [
      "$.ethereum.contracts.HTLCEscrow",
      "$.stellar.contracts.HTLC",
      "$.stellar.resolverRegistryConfig",
    ]);
  });

  it("formats an error as file:path message", () => {
    const [error] = validateDeploymentManifest({}).errors;
    assert.equal(
      formatManifestError(error, "deployments.testnet.json"),
      "deployments.testnet.json:$.network must be a non-empty string, got undefined",
    );
  });
});
