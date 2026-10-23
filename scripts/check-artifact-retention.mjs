#!/usr/bin/env node
/**
 * CLI wrapper around the artifact-retention rule (issue #384). Scans every
 * workflow file under `.github/workflows/` for `actions/upload-artifact`
 * steps and fails if an evidence or Slither upload lacks an explicit,
 * bounded `retention-days` value — including upload steps added later.
 *
 * The rule itself lives in `./lib/artifact-retention.mjs` so it can be
 * tested without touching the filesystem.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findArtifactRetentionViolations } from "./lib/artifact-retention.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WORKFLOWS_DIR = resolve(ROOT, ".github/workflows");

function workflowFiles() {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

function main() {
  const files = workflowFiles();
  const violations = [];

  for (const file of files) {
    const relativePath = `.github/workflows/${file}`;
    const text = readFileSync(resolve(WORKFLOWS_DIR, file), "utf8");
    violations.push(...findArtifactRetentionViolations(text, relativePath));
  }

  if (violations.length > 0) {
    console.error("Artifact retention check failed:");
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line}: "${violation.artifactName}" — ${violation.reason}`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`✓ All evidence/Slither artifact uploads declare a bounded retention-days (${files.length} workflow file(s) checked)`);
}

main();
