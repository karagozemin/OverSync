#!/usr/bin/env node
/**
 * Validates branch-scoped concurrency cancellation for the address consistency
 * workflow (issue #389).
 *
 * Usage:
 *   node scripts/check-address-verify-concurrency.mjs [workflowPath]
 *   pnpm check:address-verify-concurrency
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAddressVerifyConcurrencyConfig,
  validateAddressVerifyConcurrency,
} from "./lib/address-verify-concurrency.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, ".github/workflows/address-verify.yml");

const workflowText = readFileSync(workflowPath, "utf8");
const config = buildAddressVerifyConcurrencyConfig(workflowText);
const check = validateAddressVerifyConcurrency(config);

if (!check.ok) {
  console.error(`Address verification concurrency check failed for ${workflowPath}:`);
  for (const violation of check.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified branch-scoped concurrency for ${config.workflowName} (group="${config.group}", cancel-in-progress=${config.cancelInProgress}).`,
  );
}
