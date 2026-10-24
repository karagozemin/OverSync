import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildReleaseDryRunPlan,
  parseReleaseWorkflowConfig,
  validateReleaseDryRunPlan,
} from "./release-dry-run.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const cliScript = resolve(repoRoot, "scripts/release-dry-run.mjs");

describe("release dry-run workflow path", () => {
  it("parses exact image, context, Dockerfile, and platforms from release.yml", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const config = parseReleaseWorkflowConfig(workflowText);

    assert.deepEqual(config, {
      imageTemplate: "ghcr.io/${{ github.repository_owner }}/oversync-resolver",
      context: "./resolver",
      dockerfile: "./resolver/Dockerfile",
      platforms: "linux/amd64,linux/arm64",
    });
  });

  it("builds a validated no-login, no-push plan matching the release workflow", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const plan = buildReleaseDryRunPlan({
      workflowText,
      tag: "v1.2.3",
      owner: "karagozemin",
      repoRoot,
    });

    const validation = validateReleaseDryRunPlan(plan);
    assert.equal(validation.ok, true, `unexpected errors: ${validation.violations.join("; ")}`);
    assert.equal(plan.login, false);
    assert.equal(plan.push, false);
    assert.equal(plan.dockerArgs.includes("--push"), false);
    assert.deepEqual(plan.tags, [
      "ghcr.io/karagozemin/oversync-resolver:v1.2.3",
      "ghcr.io/karagozemin/oversync-resolver:1.2.3",
      "ghcr.io/karagozemin/oversync-resolver:1.2",
    ]);
  });

  it("rejects malformed tags and any plan that enables login or push", () => {
    const workflowText = readFileSync(workflowPath, "utf8");

    const badTagPlan = buildReleaseDryRunPlan({
      workflowText,
      tag: "v1.2",
      repoRoot,
    });
    assert.equal(validateReleaseDryRunPlan(badTagPlan).ok, false);

    const validPlan = buildReleaseDryRunPlan({
      workflowText,
      tag: "v1.0.0",
      repoRoot,
    });
    assert.equal(
      validateReleaseDryRunPlan({ ...validPlan, login: true }).ok,
      false,
    );
    assert.equal(
      validateReleaseDryRunPlan({ ...validPlan, push: true }).ok,
      false,
    );
    assert.equal(
      validateReleaseDryRunPlan({
        ...validPlan,
        dockerArgs: [...validPlan.dockerArgs, "--push"],
      }).ok,
      false,
    );
  });

  it("executes the dry-run CLI without registry login or image push", () => {
    const okRun = spawnSync(process.execPath, [cliScript, "--tag", "v1.0.0"], {
      encoding: "utf8",
    });
    assert.equal(okRun.status, 0);
    assert.match(okRun.stdout, /MODE\s*:\s*DRY-RUN \(no registry login, no image push\)/);
    assert.equal(okRun.stdout.includes("--push"), false);

    const failRun = spawnSync(process.execPath, [cliScript, "--tag", "invalid-tag"], {
      encoding: "utf8",
    });
    assert.equal(failRun.status, 1);
  });

  it("wires release:dry-run into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["release:dry-run"], "node scripts/release-dry-run.mjs");
  });
});
