import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  REQUIRED_CONTRACT_TRIGGER_PATHS,
  buildContractsTriggerPaths,
  shouldTriggerContractChecks,
  validateContractsPathFilterPolicy,
} from "./contracts-path-filters.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");
const cliScript = resolve(repoRoot, "scripts/check-contracts-path-filters.mjs");

describe("contract workflow lockfile and manifest path filters", () => {
  it("includes contracts/**, pnpm-lock.yaml, package.json, and pnpm-workspace.yaml in push and pull_request filters", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const policy = buildContractsTriggerPaths(workflowText);
    const result = validateContractsPathFilterPolicy(policy);

    assert.equal(result.ok, true, `unexpected errors: ${result.violations.join("; ")}`);
    for (const required of REQUIRED_CONTRACT_TRIGGER_PATHS) {
      assert.ok(policy.pushPaths.includes(required));
      assert.ok(policy.pullRequestPaths.includes(required));
    }
  });

  it("triggers contract checks when pnpm-lock.yaml or root package manifests change", () => {
    for (const changed of [
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      "contracts/contracts/v2/HTLCEscrow.sol",
      ".github/workflows/contracts.yml",
    ]) {
      const check = shouldTriggerContractChecks([changed]);
      assert.equal(check.triggered, true, `expected ${changed} to trigger contracts workflow`);
      assert.deepEqual(check.matchedFiles, [changed]);
    }

    const unrelated = shouldTriggerContractChecks([
      "frontend/src/App.tsx",
      "docs/DEPLOYMENT.md",
    ]);
    assert.equal(unrelated.triggered, false);
  });

  it("rejects path filter configurations that omit pnpm-lock.yaml or root manifests", () => {
    const missingLockfile = validateContractsPathFilterPolicy({
      pushPaths: ["contracts/**", ".github/workflows/contracts.yml"],
      pullRequestPaths: ["contracts/**", ".github/workflows/contracts.yml"],
    });

    assert.equal(missingLockfile.ok, false);
    assert.ok(
      missingLockfile.violations.some((v) => v.includes('"pnpm-lock.yaml"')),
    );
    assert.ok(
      missingLockfile.violations.some((v) => v.includes('"package.json"')),
    );
  });

  it("rejects asymmetric push and pull_request path filter lists", () => {
    const asymmetric = validateContractsPathFilterPolicy({
      pushPaths: [...REQUIRED_CONTRACT_TRIGGER_PATHS, "contracts/foundry.toml"],
      pullRequestPaths: [...REQUIRED_CONTRACT_TRIGGER_PATHS],
    });
    assert.equal(asymmetric.ok, false);
    assert.match(
      asymmetric.violations[0],
      /push\.paths and pull_request\.paths must contain the same trigger globs/,
    );
  });

  it("executes the CLI check and wires check:contracts-path-filters into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /pnpm-lock\.yaml/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:contracts-path-filters"],
      "node scripts/check-contracts-path-filters.mjs",
    );
  });
});
