import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CANONICAL_REPOSITORY_URL,
  collectWorkspaceManifests,
  expectedRepository,
  validateWorkspaceRepositoryMetadata,
} from "./workspace-repository-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace repository metadata (#394)", () => {
  it("accepts the committed workspace manifests", () => {
    const result = validateWorkspaceRepositoryMetadata(collectWorkspaceManifests(repoRoot));
    assert.equal(result.ok, true, result.violations.join("; "));
    assert.ok(result.checked >= 9, `expected >= 9 manifests, got ${result.checked}`);
  });

  it("requires every workspace to carry the canonical URL and its own directory", () => {
    const manifests = collectWorkspaceManifests(repoRoot).filter((manifest) => !manifest.isRoot);
    for (const manifest of manifests) {
      assert.deepEqual(manifest.json.repository, expectedRepository(manifest.dir), manifest.path);
    }
  });

  it("rejects a workspace without repository metadata", () => {
    const result = validateWorkspaceRepositoryMetadata([
      { path: "relayer/package.json", dir: "relayer", json: {}, isRoot: false },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((item) => item.includes("missing repository.url")));
    assert.ok(result.violations.some((item) => item.includes('expected "relayer"')));
  });

  it("rejects a foreign repository URL and a directory pointing at another package", () => {
    const result = validateWorkspaceRepositoryMetadata([
      {
        path: "packages/sdk/package.json",
        dir: "packages/sdk",
        isRoot: false,
        json: {
          repository: {
            type: "git",
            url: "https://github.com/someone-else/fork.git",
            directory: "relayer",
          },
        },
      },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 2);
  });

  it("rejects placeholder owners and non-git repository types", () => {
    const result = validateWorkspaceRepositoryMetadata([
      {
        path: "frontend/package.json",
        dir: "frontend",
        isRoot: false,
        json: {
          repository: {
            type: "svn",
            url: CANONICAL_REPOSITORY_URL,
            directory: "frontend",
            note: "https://github.com/your-username/OverSync",
          },
        },
      },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((item) => item.includes("your-username")));
    assert.ok(result.violations.some((item) => item.includes('repository.type must be "git"')));
  });

  it("does not require repository.directory on the root manifest", () => {
    const result = validateWorkspaceRepositoryMetadata([
      {
        path: "package.json",
        dir: ".",
        isRoot: true,
        json: { repository: { type: "git", url: CANONICAL_REPOSITORY_URL } },
      },
    ]);
    assert.equal(result.ok, true, result.violations.join("; "));
  });
});
