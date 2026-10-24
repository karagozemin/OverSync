#!/usr/bin/env node
/**
 * Release tag semantic version guard (issue #404).
 *
 * Usage:   node scripts/check-release-tag.mjs [tag]
 * Or:      RELEASE_TAG=v1.2.3 pnpm check:release-tag
 *
 * Set ALLOW_PRERELEASE=true to permit valid `vMAJOR.MINOR.PATCH-prerelease` tags.
 */

import { validateReleaseTag } from "./lib/release-tag.mjs";

const candidateTag =
  process.argv[2] ??
  process.env.RELEASE_TAG ??
  process.env.GITHUB_REF_NAME ??
  process.env.GITHUB_REF ??
  "";

const allowPrerelease = process.env.ALLOW_PRERELEASE === "true";
const result = validateReleaseTag(candidateTag, { allowPrerelease });

if (!result.ok) {
  console.error(`Release tag validation failed: ${result.reason}`);
  process.exitCode = 1;
} else {
  console.log(`Release tag ${result.tag} is a valid semantic version (${result.version}).`);
}
