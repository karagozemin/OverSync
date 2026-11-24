#!/usr/bin/env node
/**
 * Deterministic, read-only formatting check across workspace manifests
 * (issue #390). Exits non-zero when a package.json is not canonical 2-space
 * JSON. It never writes files.
 *
 * Usage: node scripts/check-workspace-format.mjs
 * Or:    pnpm format:check
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkspaceFormatting } from "./lib/workspace-format.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = checkWorkspaceFormatting(repoRoot);

if (!result.ok) {
  console.error(
    `Workspace formatting check failed with ${result.violations.length} violation(s) (read-only; no files were modified):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${result.checkedFiles.length} workspace manifest(s) (read-only): formatting is canonical.`,
  );
}
