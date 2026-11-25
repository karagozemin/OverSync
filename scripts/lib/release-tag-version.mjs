import { readFileSync } from "node:fs";

/**
 * Verifies that a release `v*` git tag matches the root `package.json` version
 * before container publication (issue #382).
 */

export function verifyReleaseTagVersion({ tag, packageVersion }) {
  const cleanTag = String(tag ?? "").trim();
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
