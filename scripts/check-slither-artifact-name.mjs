#!/usr/bin/env node
/**
 * Fails when the Slither artifact upload is not named with the short commit
 * SHA (issue #388).
 *
 * Usage: node scripts/check-slither-artifact-name.mjs
 * Or:    pnpm check:slither-artifact-name
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateSlitherArtifactNaming } from "./lib/slither-artifact-name.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");
const result = validateSlitherArtifactNaming(readFileSync(workflowPath, "utf8"));

if (!result.ok) {
  console.error("Slither artifact name check failed:");
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Slither artifact name is commit-specific: ${result.artifactName}`);
}
