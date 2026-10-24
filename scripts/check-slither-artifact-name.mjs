#!/usr/bin/env node
/**
 * Computes and validates commit-specific Slither report artifact names
 * (`slither-report-<short-sha>`, issue #388).
 *
 * Usage:
 *   node scripts/check-slither-artifact-name.mjs [--sha <commit-sha>]
 *   pnpm check:slither-artifact-name
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSlitherArtifactConfig,
  validateSlitherArtifactName,
} from "./lib/slither-artifact-name.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");

function parseShaArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sha" && argv[i + 1]) {
      return argv[i + 1];
    }
    if (argv[i].startsWith("--sha=")) {
      return argv[i].slice("--sha=".length);
    }
    if (!argv[i].startsWith("-")) {
      return argv[i];
    }
  }
  return process.env.GITHUB_SHA || "2c4f0992fcce82505b26329f439870d00ed9451e";
}

const commitSha = parseShaArg(process.argv.slice(2));
const workflowText = readFileSync(workflowPath, "utf8");
const config = buildSlitherArtifactConfig({ workflowText, commitSha });

if (!config.ok) {
  console.error(`Slither artifact name check failed: ${config.error}`);
  process.exit(1);
}

const validation = validateSlitherArtifactName(config.artifactName);
if (!validation.ok) {
  console.error(`Slither artifact name check failed: ${validation.reason}`);
  process.exit(1);
}

console.log(
  `Verified commit-specific Slither artifact name "${config.artifactName}" (path=${config.path}, shortSha=${config.shortSha}).`,
);
