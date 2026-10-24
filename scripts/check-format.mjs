#!/usr/bin/env node
/**
 * Deterministic, read-only formatting check across workspaces (issue #390).
 *
 * Usage:   node scripts/check-format.mjs [rootDir]
 * Or:      pnpm format:check
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkspaceFormatting } from "./lib/format-check.mjs";

const defaultRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootDir = process.argv[2] ? resolve(process.argv[2]) : defaultRoot;

const result = checkWorkspaceFormatting(rootDir);

if (!result.ok) {
  console.error(
    `Formatting check failed with ${result.violations.length} violation(s) (read-only; no files were modified):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${result.checkedFiles.length} workspace manifest(s) (read-only): formatting is clean.`,
  );
}
