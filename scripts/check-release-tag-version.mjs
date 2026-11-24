#!/usr/bin/env node
/**
 * CLI check that compares the release `v*` tag against the root `package.json`
 * version before container publication (issue #382).
 *
 * Usage:
 *   node scripts/check-release-tag-version.mjs [--tag v1.0.0]
 *   RELEASE_TAG=v1.0.0 node scripts/check-release-tag-version.mjs
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyReleaseTagAgainstManifest } from "./lib/release-tag-version.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = resolve(repoRoot, "package.json");

function parseTagArg(argv) {
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
  return process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? "";
}

const tag = parseTagArg(process.argv.slice(2));
const result = verifyReleaseTagAgainstManifest({ tag, manifestPath });

if (!result.ok) {
  console.error(`Release tag check failed: ${result.error}`);
  process.exit(1);
}

console.log(
  `Release tag ${result.tag} matches root package.json version ${result.packageVersion}.`,
);
