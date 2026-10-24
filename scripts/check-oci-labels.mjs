#!/usr/bin/env node
/**
 * Validates that service Dockerfiles and container build metadata populate
 * standard OCI labels for source URL, revision, version, and licenses (issue #400).
 *
 * Usage:
 *   node scripts/check-oci-labels.mjs
 *   pnpm check:oci-labels
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOciImageLabels,
  normalizeRepositorySourceUrl,
  validateDockerfileOciLabels,
} from "./lib/oci-image-labels.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootPkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

const dockerfiles = [
  { name: "resolver/Dockerfile", path: resolve(repoRoot, "resolver/Dockerfile") },
  { name: "relayer/Dockerfile", path: resolve(repoRoot, "relayer/Dockerfile") },
];

const violations = [];

for (const target of dockerfiles) {
  const content = readFileSync(target.path, "utf8");
  const result = validateDockerfileOciLabels(content, { name: target.name });
  if (!result.ok) {
    violations.push(...result.violations);
  }
}

const sampleRevision = process.env.GITHUB_SHA || "2c4f0992fcce82505b26329f439870d00ed9451e";
const labelCheck = buildOciImageLabels({
  source: normalizeRepositorySourceUrl(rootPkg.repository?.url ?? ""),
  revision: sampleRevision,
  version: rootPkg.version,
  licenses: rootPkg.license,
});

if (!labelCheck.ok) {
  violations.push(...labelCheck.errors);
}

if (violations.length > 0) {
  console.error("OCI image label validation failed:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified standard OCI labels (source, revision, version, licenses) across ${dockerfiles.length} Dockerfile(s).`,
  );
}
