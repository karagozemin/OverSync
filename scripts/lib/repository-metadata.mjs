import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates that the root and every workspace `package.json` declare canonical
 * `repository` metadata (`type: "git"`, `url: CANONICAL_REPOSITORY_URL`, and
 * `directory: "<workspace-dir>"` for workspace packages) (issue #394).
 */

export const CANONICAL_REPOSITORY_URL =
  "https://github.com/karagozemin/OverSync.git";
export const PLACEHOLDER_OWNER = "your-username";

export function workspaceDirs(repoRoot, rootManifest) {
  return (rootManifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

export function loadAllManifests(repoRoot) {
  const rootRaw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const rootJson = JSON.parse(rootRaw);
  const dirs = workspaceDirs(repoRoot, rootJson);

  const workspaces = dirs
    .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
    .map((dir) => {
      const raw = readFileSync(join(repoRoot, dir, "package.json"), "utf8");
      return {
        dir,
        path: `${dir}/package.json`,
        raw,
        json: JSON.parse(raw),
      };
    });

  return {
    root: { dir: ".", path: "package.json", raw: rootRaw, json: rootJson },
    workspaces,
  };
}

export function validateRepositoryMetadata({ root, workspaces }) {
  const violations = [];

  if (root?.raw?.includes(PLACEHOLDER_OWNER)) {
    violations.push(
      `package.json still contains the "${PLACEHOLDER_OWNER}" placeholder`,
    );
  }
  if (root?.json?.repository?.type !== "git") {
    violations.push('package.json repository.type must be "git"');
  }
  if (root?.json?.repository?.url !== CANONICAL_REPOSITORY_URL) {
    violations.push(
      `package.json repository.url must be "${CANONICAL_REPOSITORY_URL}"`,
    );
  }

  for (const ws of workspaces ?? []) {
    if (ws.raw?.includes(PLACEHOLDER_OWNER)) {
      violations.push(
        `${ws.path} still contains the "${PLACEHOLDER_OWNER}" placeholder`,
      );
    }

    const repo = ws.json?.repository;
    if (!repo || typeof repo !== "object") {
      violations.push(
        `${ws.path} is missing a repository object with type, url, and directory`,
      );
      continue;
    }

    if (repo.type !== "git") {
      violations.push(`${ws.path} repository.type must be "git"`);
    }
    if (repo.url !== CANONICAL_REPOSITORY_URL) {
      violations.push(
        `${ws.path} repository.url "${repo.url}" must match "${CANONICAL_REPOSITORY_URL}"`,
      );
    }
    if (repo.directory !== ws.dir) {
      violations.push(
        `${ws.path} repository.directory "${repo.directory}" must match workspace directory "${ws.dir}"`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
