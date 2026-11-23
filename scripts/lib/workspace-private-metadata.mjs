/**
 * Guards #392: a workspace that is not published to a registry must opt out of
 * publishing explicitly with `private: true`.
 *
 * "Published" is decided by the manifest itself: a non-empty `publishConfig`
 * is the explicit opt-in to publishing. Everything else — including a manifest
 * that merely has `main`/`exports` — is treated as non-published, because those
 * fields say nothing about release intent.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** True when the manifest deliberately opts into registry publishing. */
export function isPublishIntent(manifest) {
  const publishConfig = manifest?.publishConfig;
  return Boolean(
    publishConfig && typeof publishConfig === "object" && Object.keys(publishConfig).length > 0,
  );
}

/**
 * Validates `[{ path, json }]` workspace manifests.
 * Returns `{ ok, checked, violations }`, where `violations` is a list of
 * human-readable strings naming the offending manifest.
 */
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

/** Expands root `workspaces` patterns, including `dir/*` globs. */
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

/** Reads the root manifest plus every workspace manifest that exists on disk. */
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
