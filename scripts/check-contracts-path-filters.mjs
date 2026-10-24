#!/usr/bin/env node
/**
 * Validates that contract workflow path filters include root lockfile and
 * workspace manifest changes (`pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`,
 * issue #387).
 *
 * Usage:
 *   node scripts/check-contracts-path-filters.mjs
 *   pnpm check:contracts-path-filters
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildContractsTriggerPaths,
  validateContractsPathFilterPolicy,
} from "./lib/contracts-path-filters.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");

const workflowText = readFileSync(workflowPath, "utf8");
const policy = buildContractsTriggerPaths(workflowText);
const check = validateContractsPathFilterPolicy(policy);

if (!check.ok) {
  console.error("Contract workflow path filter check failed:");
  for (const violation of check.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${policy.pushPaths.length} contract workflow trigger path(s) (${policy.pushPaths.join(", ")}) across push and pull_request events.`,
  );
}
