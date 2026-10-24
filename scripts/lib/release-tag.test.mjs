import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { normalizeTagRef, validateReleaseTag } from "./release-tag.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-release-tag.mjs");

describe("release semantic version tag validation", () => {
  it("accepts canonical vMAJOR.MINOR.PATCH semantic version tags", () => {
    for (const tag of ["v0.1.0", "v1.0.0", "v2.14.9", "refs/tags/v10.20.30"]) {
      const res = validateReleaseTag(tag);
      assert.equal(res.ok, true, `expected ${tag} to pass, got: ${res.reason}`);
      assert.equal(res.prerelease, null);
    }
  });

  it("normalizes refs/tags/ prefixes and rejects non-tag refs", () => {
    assert.deepEqual(normalizeTagRef("refs/tags/v1.2.3"), { tag: "v1.2.3", error: null });
    assert.equal(validateReleaseTag("refs/heads/master").ok, false);
    assert.match(validateReleaseTag("refs/heads/v1.2.3").reason, /not a tag ref/);
  });

  it("rejects partial version tags such as v1 and v1.2", () => {
    for (const partial of ["v1", "v0", "v1.0", "v1.2", "refs/tags/v2.3"]) {
      const res = validateReleaseTag(partial);
      assert.equal(res.ok, false, `expected ${partial} to fail`);
      assert.match(res.reason, /partial release tag/);
    }
  });

  it("rejects malformed tags, missing v prefix, leading zeros, and build metadata", () => {
    for (const malformed of [
      "",
      "1.2.3",
      "v",
      "vlatest",
      "v1.2.x",
      "v1.2.3.4",
      "v01.2.3",
      "v1.02.3",
      "v1.2.03",
      "v1.2.3+build.1",
    ]) {
      const res = validateReleaseTag(malformed);
      assert.equal(res.ok, false, `expected "${malformed}" to fail`);
    }
  });

  it("rejects prerelease tags by default and accepts them only when explicitly enabled", () => {
    for (const pre of ["v1.0.0-alpha", "v1.2.3-rc.1", "v0.2.0-beta.11"]) {
      const rejected = validateReleaseTag(pre);
      assert.equal(rejected.ok, false);
      assert.match(rejected.reason, /ALLOW_PRERELEASE=true/);

      const accepted = validateReleaseTag(pre, { allowPrerelease: true });
      assert.equal(accepted.ok, true);
      assert.ok(accepted.prerelease);
    }

    // Leading zero in numeric prerelease identifier is invalid under SemVer 2.0.0
    assert.equal(validateReleaseTag("v1.2.3-rc.01", { allowPrerelease: true }).ok, false);
  });

  it("exits non-zero from the CLI for invalid tags and zero for valid tags", () => {
    const okRun = spawnSync(process.execPath, [cliScript, "v1.2.3"], { encoding: "utf8" });
    assert.equal(okRun.status, 0);
    assert.match(okRun.stdout, /valid semantic version \(1\.2\.3\)/);

    const partialRun = spawnSync(process.execPath, [cliScript, "v1.2"], { encoding: "utf8" });
    assert.equal(partialRun.status, 1);
    assert.match(partialRun.stderr, /partial release tag/);

    const preBlocked = spawnSync(process.execPath, [cliScript, "v1.2.3-rc.1"], { encoding: "utf8" });
    assert.equal(preBlocked.status, 1);

    const preAllowed = spawnSync(process.execPath, [cliScript, "v1.2.3-rc.1"], {
      encoding: "utf8",
      env: { ...process.env, ALLOW_PRERELEASE: "true" },
    });
    assert.equal(preAllowed.status, 0);
  });

  it("wires check:release-tag into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:release-tag"], "node scripts/check-release-tag.mjs");
  });
});
