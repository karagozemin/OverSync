import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  parsePackageManagerVersion,
  validatePnpmEngineMetadata,
} from "./pnpm-engine-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("pnpm engine metadata alignment", () => {
  it("aligns engines.pnpm with the exact packageManager version and CI setup", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const ciWorkflowText = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");

    const result = validatePnpmEngineMetadata({ rootManifest, ciWorkflowText });
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.equal(result.version, "8.15.0");
    assert.equal(rootManifest.engines.pnpm, "8.15.0");
  });

  it("parses exact pnpm versions and rejects non-pnpm packageManager fields", () => {
    assert.deepEqual(parsePackageManagerVersion("pnpm@8.15.0"), {
      version: "8.15.0",
      error: null,
    });
    assert.equal(parsePackageManagerVersion("npm@10.0.0").version, null);
  });

  it("rejects engines.pnpm ranges that drift from packageManager", () => {
    const drifted = validatePnpmEngineMetadata({
      rootManifest: {
        packageManager: "pnpm@8.15.0",
        engines: {
          node: ">=18.0.0",
          pnpm: ">=8.0.0",
        },
      },
    });
    assert.equal(drifted.ok, false);
    assert.match(drifted.violations[0], /engines\.pnpm ">=8\.0\.0" must match packageManager version "8\.15\.0"/);
  });
});
