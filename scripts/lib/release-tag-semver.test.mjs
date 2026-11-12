import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  validateReleaseSemverTag,
  verifyReleaseWorkflowTagGuard,
} from "./release-tag-semver.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const scriptPath = resolve(repoRoot, "scripts/lib/release-tag-semver.mjs");

describe("release semantic version tag validation", () => {
  it("accepts strict vMAJOR.MINOR.PATCH release tags", () => {
    for (const tag of ["v0.0.1", "v1.0.0", "v1.2.3", "v10.20.30"]) {
      const res = validateReleaseSemverTag(tag);
      assert.equal(res.ok, true, `expected ${tag} to be valid`);
      assert.equal(res.version, tag.slice(1));
    }
  });

  it("rejects partial, malformed, leading-zero, and prerelease tags", () => {
    const invalidTags = [
      "",
      "1.2.3",
      "v1",
      "v1.2",
      "v01.2.3",
      "v1.02.3",
      "v1.2.03",
      "v1.2.3-alpha.1",
      "v1.2.3-rc.1",
      "v1.2.3+build1",
      "vlatest",
    ];
    for (const tag of invalidTags) {
      const res = validateReleaseSemverTag(tag);
      assert.equal(res.ok, false, `expected "${tag}" to be rejected`);
    }
  });

  it("enforces tag validation in release.yml before login or build", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const check = verifyReleaseWorkflowTagGuard(workflow);
    assert.equal(
      check.ok,
      true,
      `unexpected workflow violations: ${check.violations.join("; ")}`,
    );
  });

  it("exits non-zero from the CLI when given a prerelease or partial tag", () => {
    const okRun = spawnSync(process.execPath, [scriptPath, "v1.2.3"], {
      encoding: "utf8",
    });
    assert.equal(okRun.status, 0);

    const failRun = spawnSync(process.execPath, [scriptPath, "v1.2.3-rc.1"], {
      encoding: "utf8",
    });
    assert.equal(failRun.status, 1);
    assert.match(failRun.stderr, /Invalid release tag/);
  });
});
