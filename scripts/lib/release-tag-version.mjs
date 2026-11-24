import { readFileSync } from "node:fs";

/**
 * Verifies that a release `v*` git tag matches the root `package.json` version
 * before container publication (issue #382), and that the tag is a strict
 * `vMAJOR.MINOR.PATCH` semantic version (issue #404).
 */

/**
 * Release tags must be plain stable semantic versions such as `v1.2.3`.
 * Partial (`v1`, `v1.2`), malformed (`v01.2.3`, `v1.2.3.4`, `v1.2.x`,
 * whitespace) and prerelease or build-metadata tags (`v1.2.3-rc.1`,
 * `v1.2.3+build`) are rejected because the workflow only publishes stable
 * releases.
 */
export const STRICT_RELEASE_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStrictReleaseTag(tag) {
  return typeof tag === "string" && STRICT_RELEASE_TAG_PATTERN.test(tag);
}

export function verifyReleaseTagVersion({ tag, packageVersion }) {
  const rawTag = String(tag ?? "");
  const cleanTag = rawTag.trim();
  const cleanVersion = String(packageVersion ?? "").trim();

  if (!cleanVersion) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag: null,
      error: "Root package.json is missing a non-empty version field",
    };
  }

  const expectedTag = `v${cleanVersion}`;

  if (!cleanTag) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Missing release tag; expected "${expectedTag}" to match root package.json version "${cleanVersion}"`,
    };
  }

  if (!cleanTag.startsWith("v")) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Release tag "${cleanTag}" must start with "v" (expected "${expectedTag}")`,
    };
  }

  if (rawTag !== cleanTag || !isStrictReleaseTag(cleanTag)) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Release tag ${JSON.stringify(rawTag)} is not a valid semantic version tag; expected exactly "vMAJOR.MINOR.PATCH" (for example "v1.2.3"). Partial, malformed, and prerelease tags are not released`,
    };
  }

  const tagVersion = cleanTag.slice(1);
  if (tagVersion !== cleanVersion) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Release tag "${cleanTag}" (version "${tagVersion}") does not match root package.json version "${cleanVersion}" (expected "${expectedTag}")`,
    };
  }

  return {
    ok: true,
    tag: cleanTag,
    packageVersion: cleanVersion,
    expectedTag,
    error: null,
  };
}

export function verifyReleaseTagAgainstManifest({ tag, manifestPath }) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return verifyReleaseTagVersion({
    tag,
    packageVersion: manifest?.version,
  });
}
