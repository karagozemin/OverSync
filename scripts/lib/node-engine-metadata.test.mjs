import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  parseCiNodeMajor,
  parseNodeLowerMajor,
  validateNodeEngineMetadata,
} from "./node-engine-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("node engine metadata alignment", () => {
  it("keeps every workspace engines.node lower bound at or above CI node-version", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const ciWorkflowText = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");

    // Every workspace must carry an engines.node whose lower bound is >= CI.
    const workspaces = [];
    const dirs = [".", ...rootManifest.workspaces.flatMap((pattern) => {
      if (!pattern.endsWith("/*")) return [pattern];
      const parent = pattern.slice(0, -2);
      return readdirSync(join(repoRoot, parent), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${parent}/${entry.name}`);
    })];
    for (const dir of dirs) {
      const path = dir === "." ? "package.json" : `${dir}/package.json`;
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, path), "utf8"));
      workspaces.push({ path, enginesNode: manifest.engines?.node ?? null });
    }

    const result = validateNodeEngineMetadata({ workspaces, ciWorkflowText });
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.ciNodeMajor, 22);
  });

  it("parses the CI Node major version from a setup-node block", () => {
    assert.equal(parseCiNodeMajor("node-version: 22"), 22);
    assert.equal(parseCiNodeMajor("node-version: '22.11.0'"), 22);
    assert.equal(parseCiNodeMajor("no setup-node here"), null);
  });

  it("extracts the lower-bound major from engines.node ranges", () => {
    assert.equal(parseNodeLowerMajor(">=22.0.0"), 22);
    assert.equal(parseNodeLowerMajor(">=22 <24"), 22);
    assert.equal(parseNodeLowerMajor("22.0.0"), 22);
    assert.equal(parseNodeLowerMajor(">=18.0.0"), 18);
    assert.equal(parseNodeLowerMajor(""), null);
    assert.equal(parseNodeLowerMajor(undefined), null);
  });

  it("rejects engines.node ranges below the CI toolchain", () => {
    const drifted = validateNodeEngineMetadata({
      workspaces: [{ path: "package.json", enginesNode: ">=18.0.0" }],
      ciWorkflowText: "node-version: 22",
    });
    assert.equal(drifted.ok, false);
    assert.match(drifted.violations[0], /lower bound \(18\) is below CI node-version \(22\)/);
  });

  it("flags a missing engines.node", () => {
    const missing = validateNodeEngineMetadata({
      workspaces: [{ path: "relayer/package.json", enginesNode: null }],
      ciWorkflowText: "node-version: 22",
    });
    assert.equal(missing.ok, false);
    assert.match(missing.violations[0], /relayer\/package\.json is missing engines\.node/);
  });
});
