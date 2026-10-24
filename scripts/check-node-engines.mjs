#!/usr/bin/env node
/**
 * Checks that `.nvmrc`, CI `actions/setup-node` versions, root `package.json`,
 * and every workspace `package.json` agree on the reviewed Node major version
 * (issue #395).
 *
 * Usage:   node scripts/check-node-engines.mjs
 * Or:      pnpm check:node-engines
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadRepositoryNodeMetadata,
  validateNodeEngineConsistency,
} from "./lib/node-engine-consistency.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const metadata = loadRepositoryNodeMetadata(repoRoot);
const result = validateNodeEngineConsistency(metadata);

if (!result.ok) {
  console.error(
    `Node engine consistency check failed with ${result.violations.length} violation(s):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified .nvmrc, CI workflows, and ${metadata.manifests.length} manifest(s): all aligned on Node ${result.targetMajor} (${result.expectedEngineRange}).`,
  );
}
