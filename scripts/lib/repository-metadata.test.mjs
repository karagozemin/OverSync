import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CANONICAL_REPOSITORY_URL,
  loadAllManifests,
  validateRepositoryMetadata,
} from "./repository-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("repository metadata", () => {
  const { root, workspaces } = loadAllManifests(repoRoot);

  it("points the root package.json at the canonical OverSync repository", () => {
    assert.equal(root.json.repository?.type, "git");
    assert.equal(root.json.repository?.url, CANONICAL_REPOSITORY_URL);
  });

  it("validates canonical repository URL and directory metadata across every workspace", () => {
    assert.ok(workspaces.length >= 8, "expected workspace manifests to be found");
    const result = validateRepositoryMetadata({ root, workspaces });
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
  });

  it("rejects workspaces with missing repository blocks, wrong URLs, or mismatched directory fields", () => {
    const result = validateRepositoryMetadata({
      root,
      workspaces: [
        {
          dir: "resolver",
          path: "resolver/package.json",
          raw: "{}",
          json: { name: "@oversync/resolver" },
        },
        {
          dir: "packages/sdk",
          path: "packages/sdk/package.json",
          raw: "{}",
          json: {
            name: "@oversync/sdk",
            repository: {
              type: "git",
              url: "https://github.com/other/repo.git",
              directory: "wrong-dir",
            },
          },
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) =>
        v.includes("resolver/package.json is missing a repository object"),
      ),
    );
    assert.ok(
      result.violations.some((v) =>
        v.includes("packages/sdk/package.json repository.url"),
      ),
    );
    assert.ok(
      result.violations.some((v) =>
        v.includes(
          'packages/sdk/package.json repository.directory "wrong-dir" must match workspace directory "packages/sdk"',
        ),
      ),
    );
  });
});
