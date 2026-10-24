#!/usr/bin/env node
/**
 * Rejects any non-published workspace manifest missing `"private": true`
 * (issue #392).
 *
 * Usage:   node scripts/check-workspace-private.mjs
 * Or:      pnpm check:workspace-private
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadWorkspaceManifests,
  validateWorkspacePrivateMetadata,
} from "./lib/workspace-private.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifests = loadWorkspaceManifests(repoRoot);
const result = validateWorkspacePrivateMetadata({ manifests });

if (!result.ok) {
  console.error(
    `Workspace private metadata check failed with ${result.violations.length} violation(s):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${result.checkedCount} manifest(s): every non-published workspace declares "private": true.`,
  );
}
