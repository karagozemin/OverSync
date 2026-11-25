import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  extractWorkflowNodeVersions,
  parseNodeVersion,
  validateNodeEngineMetadata,
} from "./node-engine-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Expands the root `workspaces` globs (`dir` or `dir/*`) to manifest paths. */
function loadWorkspaceManifests(rootManifest) {
  const manifests = {};
  for (const pattern of rootManifest.workspaces) {
    const dirs = pattern.endsWith("/*")
      ? readdirSync(resolve(repoRoot, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(pattern.slice(0, -2), entry.name))
      : [pattern];
    for (const dir of dirs) {
      const manifestPath = resolve(repoRoot, dir, "package.json");
      if (existsSync(manifestPath)) manifests[dir] = readJson(manifestPath);
    }
  }
  return manifests;
}

function loadWorkflows() {
  const dir = resolve(repoRoot, ".github/workflows");
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => [name, readFileSync(join(dir, name), "utf8")]),
  );
}

describe("Node engine metadata alignment", () => {
  it("aligns .nvmrc, CI setup-node, and root/workspace engines.node", () => {
    const rootManifest = readJson(resolve(repoRoot, "package.json"));
    const workspaceManifests = loadWorkspaceManifests(rootManifest);
    const workflows = loadWorkflows();

    assert.ok(Object.keys(workspaceManifests).length >= 8, "expected every workspace manifest");
    assert.ok(
      Object.values(workflows).some((text) => extractWorkflowNodeVersions(text).length > 0),
      "expected at least one CI setup-node version",
    );

    const result = validateNodeEngineMetadata({
      nvmrcText: readFileSync(resolve(repoRoot, ".nvmrc"), "utf8"),
      rootManifest,
      workspaceManifests,
      workflows,
    });
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.major, 22);
    assert.equal(result.engine, ">=22.5.0");
  });

  it("parses .nvmrc-style versions", () => {
    assert.equal(parseNodeVersion("22\n", ".nvmrc").major, 22);
    assert.equal(parseNodeVersion("v24.2.0 ", ".nvmrc").major, 24);
    assert.equal(parseNodeVersion("'22'", "ci.yml").major, 22);
    assert.equal(parseNodeVersion("lts/*", ".nvmrc").major, null);
  });

  it("rejects .nvmrc and CI disagreeing on the Node major", () => {
    const result = validateNodeEngineMetadata({
      nvmrcText: "24.2.0",
      rootManifest: { engines: { node: ">=24.0.0" } },
      workflows: { "ci.yml": "      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n" },
    });
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /ci\.yml node-version "22" disagrees with \.nvmrc Node major 24/);
  });

  it("rejects root engines.node that does not start at the reviewed major", () => {
    const result = validateNodeEngineMetadata({
      nvmrcText: "22",
      rootManifest: { engines: { node: ">=18.0.0" } },
    });
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /engines\.node ">=18\.0\.0" must start at \.nvmrc\/CI Node major 22/);

    const missing = validateNodeEngineMetadata({ nvmrcText: "22", rootManifest: {} });
    assert.match(missing.violations[0], /missing engines\.node/);
  });

  it("rejects workspaces whose engines.node is missing or drifts from the root", () => {
    const result = validateNodeEngineMetadata({
      nvmrcText: "22",
      rootManifest: { engines: { node: ">=22.5.0" } },
      workspaceManifests: {
        relayer: { engines: { node: ">=22.0.0" } },
        frontend: {},
      },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.violations, [
      'relayer/package.json engines.node ">=22.0.0" must match root engines.node ">=22.5.0"',
      "frontend/package.json is missing engines.node",
    ]);
  });
});
