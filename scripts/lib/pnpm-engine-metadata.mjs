/**
 * Validates that `engines.pnpm` in the root `package.json` agrees with the
 * exact `packageManager` version and CI's `pnpm/action-setup` version
 * (issue #391).
 */

const PACKAGE_MANAGER_RE = /^pnpm@(\d+\.\d+\.\d+)(?:\+sha[0-9a-f]+)?$/;

/**
 * Extracts the exact `X.Y.Z` pnpm version declared in `packageManager`.
 */
export function parsePackageManagerVersion(packageManagerField) {
  const raw = String(packageManagerField ?? "").trim();
  const match = raw.match(PACKAGE_MANAGER_RE);
  if (!match) {
    return {
      version: null,
      error: `packageManager "${raw}" must match "pnpm@MAJOR.MINOR.PATCH"`,
    };
  }
  return { version: match[1], error: null };
}

/**
 * Validates that `package.json` `engines.pnpm` matches the exact version in
 * `packageManager` (and, when provided, CI's `pnpm/action-setup` version).
 */
export function validatePnpmEngineMetadata({ rootManifest, ciWorkflowText = null }) {
  const violations = [];
  const parsed = parsePackageManagerVersion(rootManifest?.packageManager);
  if (parsed.error) {
    violations.push(parsed.error);
  }

  const expectedVersion = parsed.version;
  const actualEngine = rootManifest?.engines?.pnpm;

  if (!actualEngine) {
    violations.push('package.json is missing engines.pnpm');
  } else if (expectedVersion && actualEngine !== expectedVersion) {
    violations.push(
      `package.json engines.pnpm "${actualEngine}" must match packageManager version "${expectedVersion}"`,
    );
  }

  if (ciWorkflowText && expectedVersion) {
    const setupMatch = String(ciWorkflowText).match(
      /pnpm\/action-setup@v\d+[\s\S]*?version:\s*['"]?(\d+\.\d+\.\d+)['"]?/,
    );
    if (setupMatch && setupMatch[1] !== expectedVersion) {
      violations.push(
        `ci.yml pnpm/action-setup version "${setupMatch[1]}" disagrees with packageManager "${expectedVersion}"`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    version: expectedVersion,
    violations,
  };
}
