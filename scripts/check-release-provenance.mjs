#!/usr/bin/env node
/**
 * Validates Buildx provenance attestation settings for released container
 * images (issue #396).
 *
 * Usage:
 *   node scripts/check-release-provenance.mjs [--digest sha256:...]
 *   pnpm check:release-provenance
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReleaseProvenanceConfig,
  validateReleaseProvenanceConfig,
} from "./lib/release-provenance.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

function parseDigestArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--digest" && argv[i + 1]) {
      return argv[i + 1];
    }
    if (argv[i].startsWith("--digest=")) {
      return argv[i].slice("--digest=".length);
    }
  }
  return (
    process.env.IMAGE_DIGEST ??
    "sha256:2c4f0992fcce82505b26329f439870d00ed9451e2c4f0992fcce82505b26329f"
  );
}

const subjectDigest = parseDigestArg(process.argv.slice(2));
const workflowText = readFileSync(workflowPath, "utf8");
const config = buildReleaseProvenanceConfig({
  workflowText,
  mode: "max",
  subjectDigest,
});
const check = validateReleaseProvenanceConfig(config);

if (!check.ok) {
  console.error("Release image provenance attestation check failed:");
  for (const violation of check.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified release Buildx provenance attestation (${config.provenance}) tied to digest ${config.subjectDigest}.`,
  );
}
