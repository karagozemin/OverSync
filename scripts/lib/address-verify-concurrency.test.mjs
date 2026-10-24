import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CANONICAL_CONCURRENCY_GROUP,
  buildAddressVerifyConcurrencyConfig,
  extractTopLevelConcurrency,
  resolveAddressVerifyConcurrencyKey,
  validateAddressVerifyConcurrency,
} from "./address-verify-concurrency.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/address-verify.yml");
const cliScript = resolve(repoRoot, "scripts/check-address-verify-concurrency.mjs");

describe("address-verify branch-scoped concurrency cancellation", () => {
  it("builds and validates branch-scoped concurrency for address-verify.yml", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const config = buildAddressVerifyConcurrencyConfig(workflowText);
    const result = validateAddressVerifyConcurrency(config);

    assert.equal(result.ok, true, `unexpected errors: ${result.violations.join("; ")}`);
    assert.equal(config.workflowName, "address-verify");
    assert.equal(config.group, CANONICAL_CONCURRENCY_GROUP);
    assert.equal(config.cancelInProgress, true);
  });

  it("extracts explicit top-level concurrency blocks from workflow YAML", () => {
    const sample = [
      "name: address-verify",
      "concurrency:",
      "  group: ${{ github.workflow }}-${{ github.ref }}",
      "  cancel-in-progress: true",
      "jobs:",
      "  verify:",
    ].join("\n");

    const extracted = extractTopLevelConcurrency(sample);
    assert.deepEqual(extracted, {
      group: "${{ github.workflow }}-${{ github.ref }}",
      cancelInProgress: true,
    });
  });

  it("rejects un-scoped concurrency groups and cancel-in-progress: false", () => {
    const unscoped = validateAddressVerifyConcurrency({
      workflowName: "address-verify",
      group: "address-verify-global",
      cancelInProgress: true,
    });
    assert.equal(unscoped.ok, false);
    assert.match(unscoped.violations[0], /scoped by branch\/ref/);

    const noCancel = validateAddressVerifyConcurrency({
      workflowName: "address-verify",
      group: "${{ github.workflow }}-${{ github.ref }}",
      cancelInProgress: false,
    });
    assert.equal(noCancel.ok, false);
    assert.match(noCancel.violations[0], /cancel-in-progress must be true/);
  });

  it("produces distinct concurrency keys per branch while matching repeated pushes on the same ref", () => {
    const branchA1 = resolveAddressVerifyConcurrencyKey({
      ref: "refs/heads/fix/issue-389",
    });
    const branchA2 = resolveAddressVerifyConcurrencyKey({
      ref: "refs/heads/fix/issue-389",
    });
    const branchB = resolveAddressVerifyConcurrencyKey({
      ref: "refs/heads/master",
    });

    assert.equal(branchA1, branchA2);
    assert.notEqual(branchA1, branchB);
  });

  it("executes the CLI check and wires check:address-verify-concurrency into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Verified branch-scoped concurrency for address-verify/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:address-verify-concurrency"],
      "node scripts/check-address-verify-concurrency.mjs",
    );
  });
});
