import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  collectWorkspaceManifests,
  isPublishIntent,
  validateWorkspacePrivateMetadata,
  workspaceDirs,
} from "./workspace-private-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace private metadata (#392)", () => {
  it("accepts the committed workspace manifests", () => {
    const result = validateWorkspacePrivateMetadata(collectWorkspaceManifests(repoRoot));
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.ok(result.checked >= 9, `expected >= 9 manifests, got ${result.checked}`);
  });

  it("rejects a non-published workspace without a private flag", () => {
    const result = validateWorkspacePrivateMetadata([
      { path: "relayer/package.json", json: { name: "@oversync/relayer" } },
    ]);
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /relayer\/package\.json/);
    assert.match(result.violations[0], /"private": true/);
  });

  it('rejects "private": false and non-boolean values', () => {
    for (const value of [false, "true", 1, null]) {
      const result = validateWorkspacePrivateMetadata([
        { path: "frontend/package.json", json: { private: value } },
      ]);
      assert.equal(result.ok, false, `private=${JSON.stringify(value)} should fail`);
    }
  });

  it("accepts an explicit private flag and an explicit publish opt-in", () => {
    const result = validateWorkspacePrivateMetadata([
      { path: "coordinator/package.json", json: { private: true } },
      { path: "packages/sdk/package.json", json: { publishConfig: { access: "public" } } },
    ]);
    assert.equal(result.ok, true, result.violations.join("; "));
  });

  it("does not treat main/exports or an empty publishConfig as publish intent", () => {
    assert.equal(isPublishIntent({ main: "dist/index.js", exports: { ".": "./dist/index.js" } }), false);
    assert.equal(isPublishIntent({ publishConfig: {} }), false);
    assert.equal(isPublishIntent({ publishConfig: { access: "public" } }), true);
  });

  it("expands dir/* workspace globs and keeps plain directories", () => {
    const dirs = workspaceDirs(repoRoot, { workspaces: ["contracts", "packages/*"] });
    assert.ok(dirs.includes("contracts"));
    assert.ok(dirs.includes("packages/sdk"));
    assert.ok(!dirs.includes("packages/*"));
  });
});
