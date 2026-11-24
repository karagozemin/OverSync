import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  verifyReleaseTagAgainstManifest,
  verifyReleaseTagVersion,
} from "./release-tag-version.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const manifestPath = resolve(repoRoot, "package.json");
const cliPath = resolve(repoRoot, "scripts/check-release-tag-version.mjs");

describe("release tag vs root package.json version check", () => {
  it("accepts a v* tag that matches the root package version", () => {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    const res = verifyReleaseTagAgainstManifest({
      tag: `v${pkg.version}`,
      manifestPath,
    });
    assert.equal(res.ok, true);
    assert.equal(res.expectedTag, `v${pkg.version}`);
    assert.equal(res.error, null);
  });

  it("fails with a clear diagnostic when the v* tag does not match package.json", () => {
    const res = verifyReleaseTagVersion({
      tag: "v2.3.4",
      packageVersion: "1.0.0",
    });
    assert.equal(res.ok, false);
    assert.match(
      res.error,
      /Release tag "v2\.3\.4" \(version "2\.3\.4"\) does not match root package\.json version "1\.0\.0" \(expected "v1\.0\.0"\)/,
    );
  });

  it("rejects missing or non-v* tags", () => {
    const missing = verifyReleaseTagVersion({ tag: "", packageVersion: "1.0.0" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Missing release tag; expected "v1\.0\.0"/);

    const noPrefix = verifyReleaseTagVersion({
      tag: "1.0.0",
      packageVersion: "1.0.0",
    });
    assert.equal(noPrefix.ok, false);
    assert.match(noPrefix.error, /must start with "v"/);
  });

  it("exits 0 on match and exits 1 with a clear error on mismatch via CLI", () => {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    const okRun = spawnSync(
      process.execPath,
      [cliPath, "--tag", `v${pkg.version}`],
      { encoding: "utf8" },
    );
    assert.equal(okRun.status, 0);
    assert.match(okRun.stdout, /matches root package\.json version/);

    const failRun = spawnSync(
      process.execPath,
      [cliPath, "--tag", "v9.9.9"],
      { encoding: "utf8" },
    );
    assert.equal(failRun.status, 1);
    assert.match(
      failRun.stderr,
      /Release tag check failed: Release tag "v9\.9\.9".*does not match root package\.json version/,
    );
  });

  it("runs the tag/version check in release.yml before registry login and build", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const verifyPos = workflow.indexOf("check-release-tag-version.mjs");
    const loginPos = workflow.indexOf("docker/login-action");
    const buildPos = workflow.indexOf("docker/build-push-action");

    assert.ok(
      verifyPos !== -1,
      "release.yml must invoke scripts/check-release-tag-version.mjs",
    );
    assert.ok(
      verifyPos < loginPos && verifyPos < buildPos,
      "release tag verification must run before registry login and image build/push",
    );
  });

  it("wires check:release-tag into package.json", () => {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(
      pkg.scripts["check:release-tag"],
      "node scripts/check-release-tag-version.mjs",
    );
  });
});
