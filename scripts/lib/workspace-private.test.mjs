import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  loadWorkspaceManifests,
  validateWorkspacePrivateMetadata,
} from "./workspace-private.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace private metadata check", () => {
  it("requires private: true on root and every non-published workspace manifest", () => {
    const manifests = loadWorkspaceManifests(repoRoot);
    const result = validateWorkspacePrivateMetadata({ manifests });

    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.ok(result.checkedCount >= 9);
  });

  it("rejects manifests with missing or false private fields unless allowlisted", () => {
    const manifests = [
      { path: "package.json", json: { name: "oversync", private: true } },
      { path: "frontend/package.json", json: { name: "@oversync/frontend" } },
      { path: "relayer/package.json", json: { name: "@oversync/relayer", private: false } },
      { path: "packages/sdk/package.json", json: { name: "@oversync/sdk" } },
    ];

    const result = validateWorkspacePrivateMetadata({
      manifests,
      publishedAllowlist: ["@oversync/sdk"],
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 2);
    assert.match(result.violations[0], /frontend\/package\.json/);
    assert.match(result.violations[1], /relayer\/package\.json/);
  });

  it("wires check:workspace-private into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:workspace-private"],
      "node scripts/check-workspace-private.mjs",
    );
  });
});
