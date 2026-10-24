#!/usr/bin/env node
/**
 * Validates that the container release workflow retains immutable version tags
 * and avoids publishing un-gated mutable major-only tags (issue #403).
 *
 * Usage:   node scripts/check-release-image-tags.mjs [workflowPath]
 * Or:      pnpm check:release-image-tags
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateReleaseImageTagPolicy } from "./lib/release-image-tags.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, ".github/workflows/release.yml");

const workflow = readFileSync(workflowPath, "utf8");
const result = validateReleaseImageTagPolicy(workflow);

if (!result.ok) {
  console.error(`Release image tag policy check failed for ${workflowPath}:`);
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${result.rules.length} metadata tag rule(s) in ${workflowPath}: immutable version tags are retained and no un-gated major-only tag is published.`,
  );
}
