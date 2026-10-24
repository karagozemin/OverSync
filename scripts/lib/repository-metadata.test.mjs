import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CANONICAL_REPOSITORY_URL,
  loadWorkspaceRepositoryManifests,
  validateWorkspaceRepositoryMetadata,
} from "./repository-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("repository metadata", () => {
  it("points root and every workspace manifest at the canonical OverSync repository and directory", () => {
    const manifests = loadWorkspaceRepositoryManifests(repoRoot);
    const result = validateWorkspaceRepositoryMetadata(manifests);

    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.ok(result.workspaceCount >= 8, `expected >= 8 workspaces, got ${result.workspaceCount}`);
  });

  it("rejects missing repository blocks, wrong URLs, placeholder owners, or mismatched directory fields", () => {
    const result = validateWorkspaceRepositoryMetadata({
      rootManifest: {
        raw: '{"repository":{"type":"git","url":"https://github.com/karagozemin/OverSync.git"}}',
        json: {
          repository: {
            type: "git",
            url: CANONICAL_REPOSITORY_URL,
          },
        },
      },
      workspaceManifests: [
        {
          dir: "coordinator",
          raw: "{}",
          json: {},
        },
        {
          dir: "packages/sdk",
          raw: '{"repository":{"type":"git","url":"https://github.com/your-username/OverSync.git","directory":"sdk"}}',
          json: {
            repository: {
              type: "git",
              url: "https://github.com/your-username/OverSync.git",
              directory: "sdk",
            },
          },
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 4);
    assert.match(result.violations[0], /coordinator\/package\.json must declare a repository object/);
    assert.match(result.violations[1], /placeholder owner "your-username"/);
    assert.match(result.violations[2], /packages\/sdk\/package\.json repository\.url/);
    assert.match(result.violations[3], /packages\/sdk\/package\.json repository\.directory must be "packages\/sdk"/);
  });

  it("wires check:repository-metadata into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:repository-metadata"],
      "node scripts/check-repository-metadata.mjs",
    );
  });
});
