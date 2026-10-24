#!/usr/bin/env node
/**
 * Validates and optionally executes no-push Docker builds for both `resolver`
 * and `relayer` service images on pull requests (issue #398).
 *
 * Usage:
 *   node scripts/check-pr-service-images.mjs [--build] [--tag pr-check]
 *   pnpm check:pr-images
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPrServiceImagePlan,
  validatePrServiceImagePlan,
} from "./lib/pr-service-images.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  let build = process.env.PR_IMAGES_BUILD === "true";
  let tagSuffix = process.env.GITHUB_SHA
    ? process.env.GITHUB_SHA.slice(0, 7)
    : "pr-check";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--build") {
      build = true;
    } else if (arg === "--tag" && argv[i + 1]) {
      tagSuffix = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--tag=")) {
      tagSuffix = arg.slice("--tag=".length);
    }
  }

  return { build, tagSuffix };
}

const { build, tagSuffix } = parseArgs(process.argv.slice(2));
const plan = buildPrServiceImagePlan({ repoRoot, tagSuffix });
const validation = validatePrServiceImagePlan(plan);

if (!validation.ok) {
  console.error("PR service image build check failed:");
  for (const violation of validation.violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

for (const item of plan.builds) {
  console.log(
    `[pr-image:${item.service}] push=false context=${item.context} dockerfile=${item.dockerfile} cmd="docker ${item.dockerArgs.join(" ")}"`,
  );
  if (build) {
    const res = spawnSync("docker", item.dockerArgs, {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (res.status !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

console.log(
  `Verified no-push PR Docker build plan for ${plan.builds.length} service image(s): ${plan.builds.map((b) => b.service).join(", ")}.`,
);
