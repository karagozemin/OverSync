import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  loadRepositoryNodeMetadata,
  parseNvmrcMajor,
  validateNodeEngineConsistency,
} from "./node-engine-consistency.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Node engine metadata consistency", () => {
  it("aligns .nvmrc, CI workflows, root package.json, and all workspace manifests on Node 22", () => {
    const metadata = loadRepositoryNodeMetadata(repoRoot);
    const result = validateNodeEngineConsistency(metadata);

    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.targetMajor, 22);
    assert.equal(result.expectedEngineRange, ">=22.0.0");
    assert.ok(metadata.manifests.length >= 9);
  });

  it("rejects .nvmrc trailing whitespace or invalid version strings", () => {
    assert.equal(parseNvmrcMajor("24.2.0 \n").major, null);
    assert.match(parseNvmrcMajor("24.2.0 \n").error, /whitespace/);
    assert.equal(parseNvmrcMajor("lts/*\n").major, null);
  });

  it("flags mismatches between .nvmrc, CI workflows, and workspace manifests", () => {
    const result = validateNodeEngineConsistency({
      nvmrcText: "22\n",
      workflows: [{ name: "ci.yml", content: "with:\n  node-version: 20\n" }],
      manifests: [
        { path: "package.json", json: { engines: { node: ">=18.0.0" } } },
        { path: "coordinator/package.json", json: {} },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 3);
    assert.match(result.violations[0], /ci\.yml:2 uses node-version 20/);
    assert.match(result.violations[1], /package\.json engines\.node ">=18\.0\.0" disagrees/);
    assert.match(result.violations[2], /coordinator\/package\.json is missing engines\.node/);
  });

  it("wires check:node-engines into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:node-engines"], "node scripts/check-node-engines.mjs");
  });
});
