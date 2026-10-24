import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildSlitherArtifactConfig,
  formatSlitherArtifactName,
  validateSlitherArtifactName,
} from "./slither-artifact-name.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");
const cliScript = resolve(repoRoot, "scripts/check-slither-artifact-name.mjs");

describe("commit-specific Slither artifact naming", () => {
  it("formats commit-specific Slither artifact names with the short commit SHA", () => {
    const name = formatSlitherArtifactName(
      "2c4f0992fcce82505b26329f439870d00ed9451e",
    );
    assert.equal(name, "slither-report-2c4f099");

    const check = validateSlitherArtifactName(name);
    assert.equal(check.ok, true);
    assert.equal(check.shortSha, "2c4f099");
  });

  it("produces distinct artifact names across different commits", () => {
    const first = formatSlitherArtifactName(
      "2c4f0992fcce82505b26329f439870d00ed9451e",
    );
    const second = formatSlitherArtifactName(
      "8f72c7fc562ab90c68395635f5d73aae3c667b8d",
    );
    assert.notEqual(first, second);
    assert.equal(first, "slither-report-2c4f099");
    assert.equal(second, "slither-report-8f72c7f");
  });

  it("rejects static or malformed Slither artifact names and invalid commit SHAs", () => {
    const staticCheck = validateSlitherArtifactName("slither-report");
    assert.equal(staticCheck.ok, false);
    assert.match(staticCheck.reason, /missing a short commit SHA suffix/);

    assert.equal(validateSlitherArtifactName("slither-report-xyz").ok, false);
    assert.equal(validateSlitherArtifactName("slither-report-123").ok, false);
    assert.throws(() => formatSlitherArtifactName("not-a-sha!"));
  });

  it("builds a validated Slither artifact upload configuration from contracts.yml", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const config = buildSlitherArtifactConfig({
      workflowText,
      commitSha: "2c4f0992fcce82505b26329f439870d00ed9451e",
    });

    assert.equal(config.ok, true);
    assert.equal(config.uses, "actions/upload-artifact@v4");
    assert.equal(config.path, "contracts/slither-results.json");
    assert.equal(config.artifactName, "slither-report-2c4f099");
  });

  it("executes the CLI check and wires check:slither-artifact-name into package.json", () => {
    const okRun = spawnSync(
      process.execPath,
      [cliScript, "--sha", "2c4f0992fcce82505b26329f439870d00ed9451e"],
      { encoding: "utf8" },
    );
    assert.equal(okRun.status, 0, okRun.stderr);
    assert.match(okRun.stdout, /slither-report-2c4f099/);

    const failRun = spawnSync(
      process.execPath,
      [cliScript, "--sha", "invalid-sha"],
      { encoding: "utf8" },
    );
    assert.equal(failRun.status, 1);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:slither-artifact-name"],
      "node scripts/check-slither-artifact-name.mjs",
    );
  });
});
