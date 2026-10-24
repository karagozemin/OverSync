/**
 * Semantic version release tag validator (issue #404).
 *
 * Enforces strict `vMAJOR.MINOR.PATCH` tag syntax before registry login or
 * container image build, rejecting partial (`v1`, `v1.2`), malformed, build-
 * metadata (`+...`), or prerelease (`-alpha.1`, `-rc.1`) tags unless
 * prereleases are explicitly enabled via `allowPrerelease: true`
 * (`ALLOW_PRERELEASE=true`).
 */

const STABLE_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PRERELEASE_TAG_RE =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)$/;
const PARTIAL_TAG_RE = /^v\d+(?:\.\d+)?$/;

/**
 * Strips an optional `refs/tags/` prefix from a Git ref. Returns `{ tag, error }`
 * when a non-tag `refs/...` prefix is supplied.
 */
export function normalizeTagRef(rawInput) {
  const raw = String(rawInput ?? "").trim();
  if (!raw) {
    return { tag: "", error: "release tag is empty" };
  }
  if (raw.startsWith("refs/tags/")) {
    const stripped = raw.slice("refs/tags/".length);
    if (!stripped) {
      return { tag: "", error: `ref "${raw}" does not include a tag name` };
    }
    return { tag: stripped, error: null };
  }
  if (raw.startsWith("refs/")) {
    return { tag: raw, error: `ref "${raw}" is not a tag ref (expected refs/tags/vMAJOR.MINOR.PATCH)` };
  }
  return { tag: raw, error: null };
}

/**
 * Checks SemVer 2.0.0 prerelease identifiers: numeric-only identifiers must
 * not contain leading zeros (for example `01` is invalid).
 */
function hasValidPrereleaseIdentifiers(prerelease) {
  const parts = prerelease.split(".");
  if (parts.some((part) => part.length === 0)) return false;
  for (const part of parts) {
    if (!/^[0-9A-Za-z-]+$/.test(part)) return false;
    if (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")) {
      return false;
    }
  }
  return true;
}

/**
 * Validates a release tag string.
 */
export function validateReleaseTag(rawInput, options = {}) {
  const allowPrerelease = Boolean(options.allowPrerelease);
  const { tag, error } = normalizeTagRef(rawInput);

  if (error) {
    return { ok: false, tag, reason: error };
  }

  if (!tag.startsWith("v")) {
    return {
      ok: false,
      tag,
      reason: `release tag "${tag}" must start with a "v" prefix (expected vMAJOR.MINOR.PATCH)`,
    };
  }

  if (tag.includes("+")) {
    return {
      ok: false,
      tag,
      reason: `release tag "${tag}" must not include SemVer build metadata (+...)`,
    };
  }

  if (PARTIAL_TAG_RE.test(tag)) {
    return {
      ok: false,
      tag,
      reason: `partial release tag "${tag}" is not allowed; full vMAJOR.MINOR.PATCH semantic version is required`,
    };
  }

  const stableMatch = tag.match(STABLE_TAG_RE);
  if (stableMatch) {
    const [, major, minor, patch] = stableMatch;
    return {
      ok: true,
      tag,
      version: `${major}.${minor}.${patch}`,
      major: Number(major),
      minor: Number(minor),
      patch: Number(patch),
      prerelease: null,
    };
  }

  const preMatch = tag.match(PRERELEASE_TAG_RE);
  if (preMatch) {
    const [, major, minor, patch, prerelease] = preMatch;
    if (!hasValidPrereleaseIdentifiers(prerelease)) {
      return {
        ok: false,
        tag,
        reason: `prerelease tag "${tag}" has invalid prerelease identifier(s) "${prerelease}"`,
      };
    }
    if (!allowPrerelease) {
      return {
        ok: false,
        tag,
        reason: `prerelease tag "${tag}" is rejected unless ALLOW_PRERELEASE=true is explicitly set`,
      };
    }
    return {
      ok: true,
      tag,
      version: `${major}.${minor}.${patch}-${prerelease}`,
      major: Number(major),
      minor: Number(minor),
      patch: Number(patch),
      prerelease,
    };
  }

  return {
    ok: false,
    tag,
    reason: `malformed release tag "${tag}" (expected strict vMAJOR.MINOR.PATCH semantic version without leading zeros)`,
  };
}
