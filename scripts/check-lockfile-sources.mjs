#!/usr/bin/env node
/**
 * Validates every workspace importer and resolved package entry in
 * `pnpm-lock.yaml` (issue #405).
 *
 * Usage:   node scripts/check-lockfile-sources.mjs [lockfilePath]
 * Or:      pnpm check:lockfile-sources
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateLockfileSources } from "./lib/lockfile-sources.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const lockfilePath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, "pnpm-lock.yaml");

const content = readFileSync(lockfilePath, "utf8");
const result = validateLockfileSources(content);

if (!result.ok) {
  console.error(
    `Lockfile source validation failed with ${result.violations.length} violation(s) in ${lockfilePath}:`,
  );
  for (const violation of result.violations) {
    console.error(`  - line ${violation.line} [${violation.kind}]: ${violation.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${result.importerCount} workspace importer(s) and ${result.packageCount} package entry(ies) in ${lockfilePath}: all dependency sources are registry-resolved with integrity digests.`,
  );
}
