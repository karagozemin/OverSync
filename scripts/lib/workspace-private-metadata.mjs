/**
 * Guards #392: a workspace that is not published to a registry must opt out
 * of publishing with `private: true`.
 *
 * A non-empty `publishConfig` is the explicit opt-in to publishing. Fields
 * such as `main` or `exports` do not count.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function isPublishIntent(manifest) {
  const publishConfig = manifest?.publishConfig;
  return Boolean(
    publishConfig && typeof publishConfig === "object" && Object.keys(publishConfig).length > 0,
  );
}

export function validateWorkspacePrivateMetadata(manifests) {
  const violations = [];
  let checked = 0;

  for (const { path, json } of manifests) {
    checked += 1;
    if (isPublishIntent(json)) continue;

    if (json.private === undefined) {
      violations.push(
        `${path}: non-published workspace must declare "private": true (add it, or add a publishConfig to opt into publishing)`,
      );
    } else if (json.private !== true) {
      violations.push(
        `${path}: "private" must be exactly true for a non-published workspace, got ${JSON.stringify(json.private)}`,
      );
    }
  }

  return { ok: violations.length === 0, checked, violations };
}

export function workspaceDirs(repoRoot, rootManifest) {
  const patterns = rootManifest.workspaces ?? [];
  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    const parentPath = join(repoRoot, parent);
    if (!existsSync(parentPath)) return [];
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

export function collectWorkspaceManifests(repoRoot) {
  const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const manifests = [{ path: "package.json", json: root }];

  for (const dir of workspaceDirs(repoRoot, root)) {
    const manifestPath = join(repoRoot, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    manifests.push({
      path: `${dir}/package.json`,
      json: JSON.parse(readFileSync(manifestPath, "utf8")),
    });
  }

  return manifests;
}
