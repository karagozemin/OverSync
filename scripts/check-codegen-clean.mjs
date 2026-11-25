#!/usr/bin/env node
/**
 * Runs maintained artifact/code generation checks and fails if tracked files
 * are stale or modified in the worktree (issue #399).
 *
 * Usage:
 *   node scripts/check-codegen-clean.mjs
 *   pnpm check:codegen-clean
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCleanWorktreeCheck } from "./lib/clean-worktree-codegen.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const result = runCleanWorktreeCheck({
  repoRoot,
  commands: [
    {
      label: "validate-deployments",
      command: process.execPath,
      args: [resolve(repoRoot, "scripts/validate-deployments.mjs")],
    },
    {
      label: "verify-addresses",
      command: process.execPath,
      args: [resolve(repoRoot, "scripts/verify-addresses.mjs")],
    },
  ],
});

if (!result.ok) {
  console.error("Clean-worktree codegen check failed:");
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${result.trackedCount} tracked generated artifact(s) and worktree cleanliness: no stale or uncommitted generated changes detected.`,
  );
}
