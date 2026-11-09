import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  loadWorkspaceManifests,
  validateWorkspacePrivateMetadata,
} from "./workspace-private-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace private metadata check", () => {
  it("requires private: true on the root and all non-published workspaces", () => {
    const manifests = loadWorkspaceManifests(repoRoot);
    assert.ok(manifests.length >= 9, "expected root + workspace manifests");

    const result = validateWorkspacePrivateMetadata({ manifests });
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
  });

  it("flags any non-published workspace missing private: true or setting private: false", () => {
    const result = validateWorkspacePrivateMetadata({
      manifests: [
        { path: "package.json", manifest: { name: "oversync", private: true } },
        { path: "relayer/package.json", manifest: { name: "@oversync/relayer" } },
        {
          path: "frontend/package.json",
          manifest: { name: "@oversync/frontend", private: false },
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 2);
    assert.match(result.violations[0], /relayer\/package\.json.*must declare "private": true/);
    assert.match(result.violations[1], /frontend\/package\.json.*must declare "private": true/);
  });

  it("allows packages explicitly listed in publishedPackages to omit private: true", () => {
    const result = validateWorkspacePrivateMetadata({
      manifests: [
        { path: "package.json", manifest: { name: "oversync", private: true } },
        { path: "packages/sdk/package.json", manifest: { name: "@oversync/sdk" } },
      ],
      publishedPackages: ["@oversync/sdk"],
    });
    assert.equal(result.ok, true);
  });
});
