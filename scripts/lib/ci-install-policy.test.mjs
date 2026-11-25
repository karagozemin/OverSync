import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowsDir = resolve(repoRoot, ".github/workflows");

/**
 * Every CI install must use the committed dependency graph. Installing with
 * `--frozen-lockfile=false` lets CI resolve dependencies fresh, so the tested
 * graph can silently drift from the reviewed `pnpm-lock.yaml` (issue #350).
 */
function workflowFiles() {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function workflowLines(fileName) {
  return readFileSync(resolve(workflowsDir, fileName), "utf8")
    .split(/\r\n|\r|\n/)
    .map((line, index) => ({ line, number: index + 1 }));
}

/** Every line in any workflow that invokes `pnpm install`. */
function pnpmInstallLines() {
  const hits = [];
  for (const fileName of workflowFiles()) {
    for (const { line, number } of workflowLines(fileName)) {
      if (line.includes("pnpm install")) hits.push({ fileName, number, line: line.trim() });
    }
  }
  return hits;
}

describe("CI pnpm install policy", () => {
  it("has workflow files to enforce the policy on", () => {
    assert.ok(workflowFiles().length > 0, "no workflow files found");
  });

  it("never disables the frozen lockfile in CI", () => {
    for (const fileName of workflowFiles()) {
      for (const { line, number } of workflowLines(fileName)) {
        assert.equal(
          line.includes("--frozen-lockfile=false") || line.includes("--no-frozen-lockfile"),
          false,
          `${fileName}:${number} must not disable the frozen lockfile: ${line.trim()}`,
        );
      }
    }
  });

  it("installs every CI dependency graph with --frozen-lockfile", () => {
    const installs = pnpmInstallLines();
    assert.ok(installs.length > 0, "expected at least one pnpm install in CI");
    for (const { fileName, number, line } of installs) {
      assert.ok(
        line.includes("--frozen-lockfile"),
        `${fileName}:${number} must install with --frozen-lockfile: ${line}`,
      );
    }
  });

  it("keeps the committed lockfile the frozen installs resolve against", () => {
    assert.ok(
      existsSync(resolve(repoRoot, "pnpm-lock.yaml")),
      "pnpm-lock.yaml must exist for --frozen-lockfile installs",
    );
  });
});
