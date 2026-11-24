#!/usr/bin/env node
/**
 * Fails when a non-published workspace package.json omits `private: true`
 * (issue #392).
 *
 * Usage: node scripts/check-workspace-private.mjs
 * Or:    pnpm check:workspace-private
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWorkspaceManifests,
  validateWorkspacePrivateMetadata,
} from "./lib/workspace-private-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = validateWorkspacePrivateMetadata(collectWorkspaceManifests(repoRoot));

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
    `Checked ${result.checked} manifest(s): every non-published workspace declares "private": true.`,
  );
}
