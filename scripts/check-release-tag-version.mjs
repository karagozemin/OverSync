#!/usr/bin/env node
/**
 * Verifies that a release git tag (`v*`) matches the root `package.json`
 * `version` field before building or publishing container images (issue #382).
 *
 * Usage:
 *   node scripts/check-release-tag-version.mjs --tag v1.0.0
 *   node scripts/check-release-tag-version.mjs v1.0.0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseTagVersion } from "./lib/release-tag-version.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkgPath = resolve(repoRoot, "package.json");

function resolveTagArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tag" && argv[i + 1]) {
      return argv[i + 1];
    }
    if (arg.startsWith("--tag=")) {
      return arg.slice("--tag=".length);
    }
    if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return "";
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const tag = resolveTagArg(process.argv.slice(2));
const result = verifyReleaseTagVersion({ tag, packageVersion: pkg.version });

if (!result.ok) {
  console.error(`Release tag version check failed: ${result.error}`);
  process.exit(1);
}

console.log(
  `✓ Release tag ${result.tag} matches root package.json version ${result.packageVersion}`,
);
