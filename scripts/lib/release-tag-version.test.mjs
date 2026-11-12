import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkReleaseWorkflowTagVerification,
  verifyReleaseTagVersion,
} from "./release-tag-version.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const pkgPath = resolve(repoRoot, "package.json");
const cliScript = resolve(repoRoot, "scripts/check-release-tag-version.mjs");

describe("release tag vs package.json version verification (#382)", () => {
  it("accepts a v* tag that matches root package.json version", () => {
    const res = verifyReleaseTagVersion({ tag: "v1.0.0", packageVersion: "1.0.0" });
    assert.equal(res.ok, true);
    assert.equal(res.expectedTag, "v1.0.0");
    assert.equal(res.error, null);
  });

  it("rejects a v* tag when package.json version differs", () => {
    const res = verifyReleaseTagVersion({ tag: "v1.2.0", packageVersion: "1.0.0" });
    assert.equal(res.ok, false);
    assert.match(res.error, /does not match root package\.json version "1\.0\.0"/);
  });

  it("rejects missing or non-v* tags with a clear error message", () => {
    assert.equal(verifyReleaseTagVersion({ tag: "", packageVersion: "1.0.0" }).ok, false);
    assert.equal(verifyReleaseTagVersion({ tag: "1.0.0", packageVersion: "1.0.0" }).ok, false);
  });

  it("runs the CLI check before container login and build-push in release.yml without shell interpolation", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const check = checkReleaseWorkflowTagVerification(workflowText);
    assert.equal(check.ok, true, `violations: ${check.violations.join("; ")}`);

    const unsafeWorkflow =
      'run: node scripts/check-release-tag-version.mjs "${{ github.ref_name }}"';
    assert.equal(checkReleaseWorkflowTagVerification(unsafeWorkflow).ok, false);
  });

  it("CLI exits 0 via --tag or positional arg when matching package.json version and 1 on mismatch", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const okRun = spawnSync(process.execPath, [cliScript, "--tag", `v${pkg.version}`], {
      encoding: "utf8",
    });
    assert.equal(okRun.status, 0);
    assert.match(okRun.stdout, /matches root package\.json version/);

    const badRun = spawnSync(process.execPath, [cliScript, "--tag", "v99.99.99"], {
      encoding: "utf8",
    });
    assert.equal(badRun.status, 1);
    assert.match(badRun.stderr, /Release tag version check failed/);
  });
});
