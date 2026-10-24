import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Canonical repository URL and workspace `repository.directory` validator
 * (issue #394).
 */

export const CANONICAL_REPOSITORY_URL = "https://github.com/karagozemin/OverSync.git";
export const PLACEHOLDER_OWNER = "your-username";

/**
 * Expands workspace entries from the root `package.json` (including `dir/*`
 * patterns).
 */
export function expandWorkspaceDirs(repoRoot, rootManifest) {
  return (rootManifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

/**
 * Validates root and workspace `repository` blocks against the canonical
 * OverSync repository URL and workspace directory path.
 */
export function validateWorkspaceRepositoryMetadata({ rootManifest, workspaceManifests }) {
  const violations = [];

  if (String(rootManifest.raw ?? "").includes(PLACEHOLDER_OWNER)) {
    violations.push(`package.json contains placeholder owner "${PLACEHOLDER_OWNER}"`);
  }
  if (rootManifest.json?.repository?.type !== "git") {
    violations.push('package.json repository.type must be "git"');
  }
  if (rootManifest.json?.repository?.url !== CANONICAL_REPOSITORY_URL) {
    violations.push(
      `package.json repository.url must be "${CANONICAL_REPOSITORY_URL}" (got "${rootManifest.json?.repository?.url ?? ""}")`,
    );
  }

  for (const ws of workspaceManifests) {
    const manifestPath = `${ws.dir}/package.json`;
    if (String(ws.raw ?? "").includes(PLACEHOLDER_OWNER)) {
      violations.push(`${manifestPath} contains placeholder owner "${PLACEHOLDER_OWNER}"`);
    }

    const repo = ws.json?.repository;
    if (!repo || typeof repo !== "object") {
      violations.push(
        `${manifestPath} must declare a repository object with type, url, and directory`,
      );
      continue;
    }

    if (repo.type !== "git") {
      violations.push(`${manifestPath} repository.type must be "git" (got "${repo.type ?? ""}")`);
    }
    if (repo.url !== CANONICAL_REPOSITORY_URL) {
      violations.push(
        `${manifestPath} repository.url must be "${CANONICAL_REPOSITORY_URL}" (got "${repo.url ?? ""}")`,
      );
    }
    if (repo.directory !== ws.dir) {
      violations.push(
        `${manifestPath} repository.directory must be "${ws.dir}" (got "${repo.directory ?? ""}")`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    workspaceCount: workspaceManifests.length,
    violations,
  };
}

/**
 * Reads the root and workspace manifests from `repoRoot`.
 */
export function loadWorkspaceRepositoryManifests(repoRoot) {
  const rootRaw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const rootJson = JSON.parse(rootRaw);
  const dirs = expandWorkspaceDirs(repoRoot, rootJson);

  const workspaceManifests = dirs
    .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
    .map((dir) => {
      const raw = readFileSync(join(repoRoot, dir, "package.json"), "utf8");
      return { dir, raw, json: JSON.parse(raw) };
    });

  return {
    rootManifest: { raw: rootRaw, json: rootJson },
    workspaceManifests,
  };
}
