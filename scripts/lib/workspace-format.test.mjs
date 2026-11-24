import assert from "node:assert/strict";
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

describe("deterministic workspace formatting (#390)", () => {
  it("accepts the committed workspace manifests without rewriting them", () => {
    const result = checkWorkspaceFormatting(repoRoot);
    assert.equal(result.ok, true, result.violations.join("; "));
    assert.ok(result.checkedFiles.length >= 9);
  });

  it("wires a read-only format:check script into package.json and ci.yml", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const ciWorkflowText = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const config = validateFormatCheckConfig({ rootManifest, ciWorkflowText });
    assert.equal(config.ok, true, config.violations.join("; "));
    assert.equal(config.script, "node scripts/check-workspace-format.mjs");
  });

  it("rejects non-canonical JSON and mutating format scripts", () => {
    const unformatted = checkJsonFormatting('{\n    "name": "bad"\n}\n', "pkg.json");
    assert.equal(unformatted.ok, false);
    assert.match(unformatted.violations[0], /canonical 2-space JSON/);

    const mutating = validateFormatCheckConfig({
      rootManifest: { scripts: { "format:check": "prettier --write ." } },
      ciWorkflowText: "run: pnpm format:check",
    });
    assert.equal(mutating.ok, false);
    assert.ok(mutating.violations.some((item) => item.includes("never pass --write")));
  });
});
