#!/usr/bin/env node
/**
 * Deterministic, read-only formatting check across workspaces (issue #390).
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkspaceFormatting } from "./lib/workspace-format.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = checkWorkspaceFormatting(repoRoot);

if (!result.ok) {
  console.error("Workspace formatting check failed:");
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(
  `Verified deterministic formatting across ${result.checkedFiles.length} workspace manifests.`,
);
