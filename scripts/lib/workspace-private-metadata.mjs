import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates that the root manifest and every non-published workspace package
 * explicitly declare `"private": true` so internal packages cannot be
 * accidentally published to a public registry (issue #392).
 */

export const PUBLISHED_WORKSPACES = Object.freeze([]);

export function loadWorkspaceManifests(repoRoot) {
  const rootPath = join(repoRoot, "package.json");
  const rootJson = JSON.parse(readFileSync(rootPath, "utf8"));
  const patterns = Array.isArray(rootJson.workspaces) ? rootJson.workspaces : [];

  const dirs = patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    const parentAbs = join(repoRoot, parent);
    if (!existsSync(parentAbs)) return [];
    return readdirSync(parentAbs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });

  const manifests = [{ path: "package.json", manifest: rootJson }];
  for (const dir of dirs) {
    const manifestAbs = join(repoRoot, dir, "package.json");
    if (!existsSync(manifestAbs)) continue;
    manifests.push({
      path: `${dir}/package.json`,
      manifest: JSON.parse(readFileSync(manifestAbs, "utf8")),
    });
  }
  return manifests;
}

export function validateWorkspacePrivateMetadata({
  manifests,
  publishedPackages = PUBLISHED_WORKSPACES,
}) {
  const publishedSet = new Set(publishedPackages);
  const violations = [];

  for (const entry of manifests ?? []) {
    const pkgName = entry?.manifest?.name ?? entry?.path;
    if (publishedSet.has(pkgName)) {
      continue;
    }
    if (entry?.manifest?.private !== true) {
      violations.push(
        `${entry.path} (${pkgName}) is not a published package and must declare "private": true`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
