#!/usr/bin/env node
/**
 * No-login, no-push release dry-run runner (issue #402).
 *
 * Validates release metadata against `.github/workflows/release.yml` and
 * optionally builds the exact release image locally without logging in to a
 * registry or pushing tags.
 *
 * Usage:
 *   node scripts/release-dry-run.mjs [--tag v1.0.0] [--build]
 *   pnpm release:dry-run
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReleaseDryRunPlan,
  validateReleaseDryRunPlan,
} from "./lib/release-dry-run.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const pkgPath = resolve(repoRoot, "package.json");

function parseCliArgs(argv) {
  let tag = process.env.RELEASE_TAG ?? null;
  let build = process.env.RELEASE_DRY_RUN_BUILD === "true";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--build") {
      build = true;
    } else if (arg === "--tag" && argv[i + 1]) {
      tag = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--tag=")) {
      tag = arg.slice("--tag=".length);
    } else if (!arg.startsWith("-") && !tag) {
      tag = arg;
    }
  }

  if (!tag) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    tag = `v${pkg.version}`;
  }

  return { tag, build };
}

const { tag, build } = parseCliArgs(process.argv.slice(2));
const workflowText = readFileSync(workflowPath, "utf8");
const plan = buildReleaseDryRunPlan({
  workflowText,
  tag,
  owner: process.env.GITHUB_REPOSITORY_OWNER || "karagozemin",
  repoRoot,
});
const check = validateReleaseDryRunPlan(plan);

if (!check.ok) {
  console.error(`Release dry-run validation failed:`);
  for (const violation of check.violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("=== OverSync Release Dry-Run ===");
console.log("MODE       : DRY-RUN (no registry login, no image push)");
console.log(`Tag        : ${plan.tag} (version ${plan.version})`);
console.log(`Context    : ${plan.context}`);
console.log(`Dockerfile : ${plan.dockerfile}`);
console.log(`Platforms  : ${plan.platforms}`);
console.log(`Tags       : ${plan.tags.join(", ")}`);
console.log(`Command    : docker ${plan.dockerArgs.join(" ")}`);

if (build) {
  const res = spawnSync("docker", plan.dockerArgs, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}
