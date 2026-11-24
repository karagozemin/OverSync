/**
 * Guards #394: every workspace package.json points at the canonical OverSync
 * repository and names its own directory inside it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CANONICAL_REPOSITORY_URL = "https://github.com/karagozemin/OverSync.git";
const PLACEHOLDER_OWNERS = ["your-username", "your-org", "example"];

export function expectedRepository(dir) {
  return { type: "git", url: CANONICAL_REPOSITORY_URL, directory: dir };
}

function repositoryUrl(manifest) {
  const { repository } = manifest;
  return typeof repository === "string" ? repository : repository?.url;
}

export function validateWorkspaceRepositoryMetadata(manifests) {
  const violations = [];
  let checked = 0;

  for (const { path, dir, json, isRoot } of manifests) {
    checked += 1;
    const serialized = JSON.stringify(json.repository ?? {});

    for (const owner of PLACEHOLDER_OWNERS) {
      if (serialized.includes(owner)) {
        violations.push(`${path}: repository still contains the "${owner}" placeholder`);
      }
    }

    const url = repositoryUrl(json);
    if (!url) {
      violations.push(`${path}: missing repository.url, expected ${CANONICAL_REPOSITORY_URL}`);
    } else if (url !== CANONICAL_REPOSITORY_URL) {
      violations.push(`${path}: repository.url "${url}" must be ${CANONICAL_REPOSITORY_URL}`);
    }

    if (typeof json.repository === "object" && json.repository?.type !== "git") {
      violations.push(`${path}: repository.type must be "git"`);
    }

    if (isRoot) continue;

    const directory = json.repository?.directory;
    if (!directory) {
      violations.push(`${path}: missing repository.directory, expected "${dir}"`);
    } else if (directory !== dir) {
      violations.push(`${path}: repository.directory "${directory}" must be "${dir}"`);
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
  const manifests = [{ path: "package.json", dir: ".", json: root, isRoot: true }];

  for (const dir of workspaceDirs(repoRoot, root)) {
    const manifestPath = join(repoRoot, dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    manifests.push({
      path: `${dir}/package.json`,
      dir,
      json: JSON.parse(readFileSync(manifestPath, "utf8")),
      isRoot: false,
    });
  }

  return manifests;
}
