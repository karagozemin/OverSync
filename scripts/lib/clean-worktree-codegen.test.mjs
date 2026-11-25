import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  TRACKED_GENERATED_ARTIFACTS,
  diffTrackedSnapshots,
  parseGitStatusPorcelain,
  runCleanWorktreeCheck,
  snapshotTrackedFiles,
  verifyGeneratedArtifactSync,
} from "./clean-worktree-codegen.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-codegen-clean.mjs");

function createFixtureWorktree() {
  const tmp = mkdtempSync(join(tmpdir(), "oversync-codegen-clean-"));
  for (const relPath of TRACKED_GENERATED_ARTIFACTS) {
    const src = resolve(repoRoot, relPath);
    const dst = join(tmp, relPath);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src, "utf8"), "utf8");
  }
  return tmp;
}

describe("clean-worktree check after code generation", () => {
  it("verifies that committed generated artifacts are in sync and leave a clean worktree", () => {
    const sync = verifyGeneratedArtifactSync(repoRoot);
    assert.equal(sync.ok, true, `unexpected stale artifacts: ${sync.stale.join("; ")}`);

    const result = runCleanWorktreeCheck({ repoRoot, porcelainOutput: "" });
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.dirty.length, 0);
  });

  it("detects tracked file modifications left behind by a generator step", () => {
    const tmp = createFixtureWorktree();
    try {
      const mutatorScript = join(tmp, "mutate-artifact.mjs");
      const targetArtifact = join(tmp, "contracts/v2-bytecode-hashes.json");
      writeFileSync(
        mutatorScript,
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(targetArtifact)}, JSON.stringify({ HTLCEscrow: ${JSON.stringify("0x" + "a".repeat(64))}, ResolverRegistry: ${JSON.stringify("0x" + "b".repeat(64))} }, null, 2));\n`,
        "utf8",
      );

      const result = runCleanWorktreeCheck({
        repoRoot: tmp,
        porcelainOutput: "",
        commands: [
          {
            label: "mutate-bytecode-hashes",
            command: process.execPath,
            args: [mutatorScript],
          },
        ],
      });

      assert.equal(result.ok, false);
      assert.deepEqual(result.dirty, [
        { path: "contracts/v2-bytecode-hashes.json", status: "modified" },
      ]);
      assert.match(result.violations[0], /contracts\/v2-bytecode-hashes\.json/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("flags stale generated SDK deployment evidence when addresses drift from deployments.testnet.json", () => {
    const tmp = createFixtureWorktree();
    try {
      const sdkEvidencePath = join(
        tmp,
        "packages/sdk/src/deployment-evidence/deployments.testnet.json",
      );
      const evidence = JSON.parse(readFileSync(sdkEvidencePath, "utf8"));
      evidence.deployments[0].address = "0x000000000000000000000000000000000000dead";
      writeFileSync(sdkEvidencePath, JSON.stringify(evidence, null, 2), "utf8");

      const result = runCleanWorktreeCheck({ repoRoot: tmp, porcelainOutput: "" });
      assert.equal(result.ok, false);
      assert.ok(result.stale.some((msg) => msg.includes("stale Ethereum HTLC address")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("parses git status --porcelain output and ignores untracked files by default", () => {
    const porcelain = [
      " M packages/sdk/src/ethereum/abi.ts",
      "M  contracts/v2-bytecode-hashes.json",
      "?? tmp/scratch.log",
    ].join("\n");

    const dirty = parseGitStatusPorcelain(porcelain);
    assert.deepEqual(dirty, [
      { status: "M", path: "packages/sdk/src/ethereum/abi.ts" },
      { status: "M", path: "contracts/v2-bytecode-hashes.json" },
    ]);

    const result = runCleanWorktreeCheck({
      repoRoot,
      porcelainOutput: porcelain,
    });
    assert.equal(result.ok, false);
    assert.equal(result.dirty.length, 2);
  });

  it("diffs tracked file snapshots for added, modified, and deleted entries", () => {
    const before = new Map([
      ["a.json", "hash1"],
      ["b.json", "hash2"],
      ["c.json", null],
    ]);
    const after = new Map([
      ["a.json", "hash1-changed"],
      ["b.json", null],
      ["c.json", "hash3"],
    ]);

    assert.deepEqual(diffTrackedSnapshots(before, after), [
      { path: "a.json", status: "modified" },
      { path: "b.json", status: "deleted" },
      { path: "c.json", status: "added" },
    ]);
    assert.equal(snapshotTrackedFiles(repoRoot).size, TRACKED_GENERATED_ARTIFACTS.length);
  });

  it("executes the CLI check and wires check:codegen-clean into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Verified 4 tracked generated artifact\(s\)/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:codegen-clean"], "node scripts/check-codegen-clean.mjs");
  });
});
