import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkJsonFormatting,
  checkWorkspaceFormatting,
  validateFormatCheckConfig,
} from "./workspace-format.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliPath = resolve(repoRoot, "scripts/check-workspace-format.mjs");

describe("deterministic formatting check across workspaces", () => {
  it("verifies formatting across all workspace manifests without modifying files", () => {
    const res = checkWorkspaceFormatting(repoRoot);
    assert.equal(
      res.ok,
      true,
      `unexpected formatting violations: ${res.violations.join("; ")}`,
    );
    assert.ok(res.checkedFiles.length >= 9);
  });

  it("wires a read-only format:check script into package.json and ci.yml", () => {
    const rootManifest = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    );
    const ciWorkflowText = readFileSync(
      resolve(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    const config = validateFormatCheckConfig({ rootManifest, ciWorkflowText });
    assert.equal(
      config.ok,
      true,
      `unexpected config violations: ${config.violations.join("; ")}`,
    );
  });

  it("detects unformatted JSON and rejects mutating --write scripts", () => {
    const unformatted = checkJsonFormatting('{\n    "name": "bad"\n}\n', "pkg.json");
    assert.equal(unformatted.ok, false);
    assert.match(unformatted.violations[0], /canonical 2-space JSON indentation/);

    const mutating = validateFormatCheckConfig({
      rootManifest: { scripts: { "format:check": "prettier --write ." } },
      ciWorkflowText: "run: pnpm format:check",
    });
    assert.equal(mutating.ok, false);
    assert.ok(
      mutating.violations.some((v) => v.includes("never pass --write")),
    );
  });

  it("executes the CLI check cleanly", () => {
    const run = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /Verified deterministic formatting/);
  });
});
