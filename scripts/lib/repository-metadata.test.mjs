import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The canonical OverSync repository every manifest should point at. */
const CANONICAL_REPOSITORY_URL = "https://github.com/karagozemin/OverSync.git";
const PLACEHOLDER_OWNER = "your-username";

function readManifest(dir) {
  const path = join(repoRoot, dir, "package.json");
  const raw = readFileSync(path, "utf8");
  return { path: join(dir, "package.json"), raw, json: JSON.parse(raw) };
}

/** Workspace directories from the root manifest, with `dir/*` globs expanded. */
function workspaceDirs(rootManifest) {
  return rootManifest.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function repositoryUrl(manifest) {
  const { repository } = manifest;
  return typeof repository === "string" ? repository : repository?.url;
}

describe("repository metadata", () => {
  const root = readManifest(".");

  it("points the root package.json at the canonical OverSync repository", () => {
    assert.equal(root.json.repository?.type, "git");
    assert.equal(root.json.repository?.url, CANONICAL_REPOSITORY_URL);
  });

  it("has no placeholder repository owner in any workspace manifest", () => {
    const manifests = [
      root,
      ...workspaceDirs(root.json)
        .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
        .map(readManifest),
    ];
    assert.ok(manifests.length > 1, "expected workspace manifests to be found");

    for (const manifest of manifests) {
      assert.ok(
        !manifest.raw.includes(PLACEHOLDER_OWNER),
        `${manifest.path} still contains the "${PLACEHOLDER_OWNER}" placeholder`,
      );
      const url = repositoryUrl(manifest.json);
      if (url !== undefined) {
        assert.equal(url, CANONICAL_REPOSITORY_URL, `${manifest.path} repository URL`);
      }
    }
  });
});
