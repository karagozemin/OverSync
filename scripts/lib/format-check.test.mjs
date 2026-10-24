import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkJsonFormatting,
  checkWorkspaceFormatting,
  validateFormatCheckScript,
} from "./format-check.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-format.mjs");

describe("deterministic workspace formatting check", () => {
  it("validates formatting across root and all workspaces without modifying files", () => {
    const before = readFileSync(resolve(repoRoot, "package.json"), "utf8");
    const result = checkWorkspaceFormatting(repoRoot);
    const after = readFileSync(resolve(repoRoot, "package.json"), "utf8");

    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.readOnly, true);
    assert.ok(result.checkedFiles.length >= 9);
    assert.equal(after, before, "checkWorkspaceFormatting must never rewrite files");
  });

  it("flags tab indentation, trailing whitespace, BOM, and non-2-space JSON layout", () => {
    assert.deepEqual(checkJsonFormatting("package.json", '{\n  "name": "ok"\n}\n'), []);
    assert.ok(
      checkJsonFormatting("package.json", '\uFEFF{\n  "name": "bom"\n}\n').some((v) =>
        v.includes("UTF-8 BOM"),
      ),
    );
    assert.ok(
      checkJsonFormatting("package.json", '{\n\t"name": "tabs"\n}\n').some((v) =>
        v.includes("tab indentation"),
      ),
    );
    assert.ok(
      checkJsonFormatting("package.json", '{"name":"compact"}\n').some((v) =>
        v.includes("canonical 2-space layout"),
      ),
    );
  });

  it("rejects format:check commands that pass mutating flags", () => {
    assert.equal(validateFormatCheckScript("node scripts/check-format.mjs").ok, true);
    assert.equal(validateFormatCheckScript("prettier --write .").ok, false);
    assert.equal(validateFormatCheckScript("prettier -w .").ok, false);
    assert.equal(validateFormatCheckScript("eslint --fix .").ok, false);
    assert.equal(validateFormatCheckScript("").ok, false);
  });

  it("exits 0 from the CLI on the repository", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /read-only/);
  });
});
