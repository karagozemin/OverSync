import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  EXPECTED_NODE_ENGINE_RANGE,
  loadNodeEngineManifests,
  parseNvmrcMajor,
  validateNodeEngineMetadata,
} from "./node-engine-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Node engine metadata alignment", () => {
  it("aligns .nvmrc, CI setup-node, and engines.node across root and all workspaces", () => {
    const manifests = loadNodeEngineManifests(repoRoot);
    const nvmrcText = readFileSync(resolve(repoRoot, ".nvmrc"), "utf8");
    const ciWorkflowText = readFileSync(
      resolve(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    const result = validateNodeEngineMetadata({
      manifests,
      nvmrcText,
      ciWorkflowText,
    });
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.equal(result.expectedRange, EXPECTED_NODE_ENGINE_RANGE);
  });

  it("parses .nvmrc versions and rejects drifted or missing engines.node fields", () => {
    assert.equal(parseNvmrcMajor("22\n").major, "22");
    assert.equal(parseNvmrcMajor("v22.5.0").major, "22");

    const drifted = validateNodeEngineMetadata({
      nvmrcText: "24.2.0",
      manifests: [
        { path: "package.json", manifest: { engines: { node: ">=18.0.0" } } },
        { path: "contracts/package.json", manifest: {} },
      ],
    });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.violations.some((v) => v.includes(".nvmrc Node major")));
    assert.ok(
      drifted.violations.some((v) =>
        v.includes("contracts/package.json is missing engines.node"),
      ),
    );
  });
});
