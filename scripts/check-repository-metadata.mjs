#!/usr/bin/env node
/**
 * Validates that root and workspace `package.json` manifests declare canonical
 * OverSync repository URLs and matching `repository.directory` fields
 * (issue #394).
 *
 * Usage:   node scripts/check-repository-metadata.mjs
 * Or:      pnpm check:repository-metadata
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadWorkspaceRepositoryManifests,
  validateWorkspaceRepositoryMetadata,
} from "./lib/repository-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifests = loadWorkspaceRepositoryManifests(repoRoot);
const result = validateWorkspaceRepositoryMetadata(manifests);

if (!result.ok) {
  console.error(
    `Repository metadata check failed with ${result.violations.length} violation(s):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified root package.json and ${result.workspaceCount} workspace manifest(s): all repository URLs and directory fields match canonical OverSync locations.`,
  );
}
