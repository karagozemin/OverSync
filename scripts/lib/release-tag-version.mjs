/**
 * Release tag vs. root package.json version verifier (issue #382).
 *
 * Ensures that before `.github/workflows/release.yml` builds or publishes a
 * container image for a `v*` tag, the tag matches `v${package.json.version}`.
 */

const TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function verifyReleaseTagVersion({ tag, packageVersion }) {
  const cleanTag = String(tag ?? "").trim();
  const cleanVersion = String(packageVersion ?? "").trim();

  if (!cleanVersion) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag: null,
      error: "root package.json is missing a valid version string",
    };
  }

  const expectedTag = `v${cleanVersion}`;

  if (!cleanTag) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Release tag is required (expected "${expectedTag}")`,
    };
  }

  if (!TAG_RE.test(cleanTag)) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Invalid release tag "${cleanTag}": must start with "v" followed by a valid semantic version (expected "${expectedTag}")`,
    };
  }

  if (cleanTag !== expectedTag) {
    return {
      ok: false,
      tag: cleanTag,
      packageVersion: cleanVersion,
      expectedTag,
      error: `Release tag "${cleanTag}" does not match root package.json version "${cleanVersion}" (expected tag "${expectedTag}")`,
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

export function checkReleaseWorkflowTagVerification(workflowText) {
  const source = String(workflowText ?? "");
  const violations = [];

  const verifyIndex = source.indexOf("check-release-tag-version.mjs");
  const loginIndex = source.indexOf("docker/login-action");
  const buildPushIndex = source.indexOf("docker/build-push-action");

  if (verifyIndex === -1) {
    violations.push(
      "release.yml must invoke scripts/check-release-tag-version.mjs to verify the release tag against package.json version",
    );
  } else {
    if (loginIndex !== -1 && verifyIndex > loginIndex) {
      violations.push(
        "release tag version verification must run before docker/login-action",
      );
    }
    if (buildPushIndex !== -1 && verifyIndex > buildPushIndex) {
      violations.push(
        "release tag version verification must run before docker/build-push-action",
      );
    }
    if (/run:[^\r\n]*\$\{\{\s*github\.ref_name\s*\}\}/.test(source)) {
      violations.push(
        "release.yml must pass github.ref_name via env rather than inline run shell interpolation",
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
