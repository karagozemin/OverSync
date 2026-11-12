import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Strict semantic version tag validator for `.github/workflows/release.yml` (issue #404).
 *
 * Accepts only `vMAJOR.MINOR.PATCH` with non-leading-zero integers and rejects
 * partial, malformed, or prerelease/build-metadata tags before registry login
 * or image builds.
 */

export const STRICT_SEMVER_TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Validates a release git tag string.
 *
 * @param {unknown} tag
 * @returns {{ ok: boolean, tag: string, version: string | null, reason: string | null }}
 */
export function validateReleaseSemverTag(tag) {
  const normalized = typeof tag === "string" ? tag.trim() : "";
  if (normalized.length === 0) {
    return {
      ok: false,
      tag: normalized,
      version: null,
      reason: "Release tag must not be empty",
    };
  }

  const match = normalized.match(STRICT_SEMVER_TAG_PATTERN);
  if (!match) {
    return {
      ok: false,
      tag: normalized,
      version: null,
      reason: `Invalid release tag "${normalized}": expected strict vMAJOR.MINOR.PATCH semantic version without prerelease or build suffixes`,
    };
  }

  return {
    ok: true,
    tag: normalized,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    reason: null,
  };
}

/**
 * Inspects `.github/workflows/release.yml` to verify that tag syntax validation
 * runs before `docker/login-action` and `docker/build-push-action`.
 *
 * @param {string} workflowText
 */
export function verifyReleaseWorkflowTagGuard(workflowText) {
  const source = String(workflowText);
  const violations = [];

  if (!source.includes("'v[0-9]*.[0-9]*.[0-9]*'")) {
    violations.push(
      "release.yml push.tags trigger must restrict tags to 'v[0-9]*.[0-9]*.[0-9]*'",
    );
  }

  const validateIndex = source.indexOf("Validate release tag syntax");
  const loginIndex = source.indexOf("docker/login-action");
  const buildIndex = source.indexOf("docker/build-push-action");

  if (validateIndex === -1) {
    violations.push("release.yml is missing the 'Validate release tag syntax' step");
  } else {
    if (loginIndex !== -1 && validateIndex > loginIndex) {
      violations.push("tag validation must execute before docker/login-action");
    }
    if (buildIndex !== -1 && validateIndex > buildIndex) {
      violations.push("tag validation must execute before docker/build-push-action");
    }
    if (/run:[^\r\n]*\$\{\{\s*github\.ref_name\s*\}\}/.test(source)) {
      violations.push("release.yml must pass github.ref_name via env rather than inline run shell interpolation");
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const candidate = process.argv[2] ?? "";
  const result = validateReleaseSemverTag(candidate);
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }
  console.log(`Validated release tag ${result.tag} (version ${result.version})`);
}
