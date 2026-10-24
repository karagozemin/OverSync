import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Workspace `private: true` metadata validator (issue #392).
 *
 * Ensures root `package.json` and every non-published workspace `package.json`
 * explicitly declare `"private": true` so `pnpm publish` or `npm publish`
 * cannot accidentally publish an internal service or workspace package.
 */

export const PUBLISHED_WORKSPACES = Object.freeze([]);

function expandWorkspaceDirs(repoRoot, rootManifest) {
  return (rootManifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

/**
 * Validates that root and every non-published workspace manifest declare
 * `"private": true`.
 */
export function validateWorkspacePrivateMetadata({
  manifests,
  publishedAllowlist = PUBLISHED_WORKSPACES,
}) {
  const allow = new Set(publishedAllowlist);
  const violations = [];

  for (const manifest of manifests) {
    const pkgName = manifest.json?.name ?? manifest.path;
    if (allow.has(manifest.path) || allow.has(pkgName)) {
      continue;
    }

    if (manifest.json?.private !== true) {
      violations.push(
        `${manifest.path} (${pkgName}) must explicitly declare "private": true`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    checkedCount: manifests.length,
    violations,
  };
}

/**
 * Loads root `package.json` and all workspace `package.json` files from `repoRoot`.
 */
export function loadWorkspaceManifests(repoRoot) {
  const rootRaw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const rootJson = JSON.parse(rootRaw);
  const dirs = expandWorkspaceDirs(repoRoot, rootJson);

  return [
    { path: "package.json", json: rootJson },
    ...dirs
      .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
      .map((dir) => ({
        path: `${dir}/package.json`,
        json: JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8")),
      })),
  ];
}
