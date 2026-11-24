#!/usr/bin/env node
/**
 * Fails when a workspace package.json does not point at the canonical OverSync
 * repository with its own repository.directory (issue #394).
 *
 * Usage: node scripts/check-workspace-repository.mjs
 * Or:    pnpm check:workspace-repository
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectWorkspaceManifests,
  validateWorkspaceRepositoryMetadata,
} from "./lib/workspace-repository-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = validateWorkspaceRepositoryMetadata(collectWorkspaceManifests(repoRoot));

if (!result.ok) {
  console.error(
    `Workspace repository metadata check failed with ${result.violations.length} violation(s):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${result.checked} manifest(s): all repository URLs and workspace directories are canonical.`,
  );
}
