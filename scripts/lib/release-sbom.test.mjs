import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { verifyReleaseSbomConfig } from "./release-sbom.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

describe("resolver container release SBOM generation (#374)", () => {
  it("generates a CycloneDX SBOM and uploads it with a short retention period in release.yml", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = verifyReleaseSbomConfig(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected SBOM workflow violations: ${result.violations.join("; ")}`,
    );
    assert.equal(result.format, "cyclonedx-json");
    assert.equal(result.outputFile, "resolver-sbom.cdx.json");
    assert.equal(result.retentionDays, 14);
  });

  it("rejects workflows missing SBOM generation or bounded retention-days", () => {
    const missingSbom = "jobs:\n  resolver-docker:\n    steps:\n      - uses: actions/checkout@v4\n";
    assert.equal(verifyReleaseSbomConfig(missingSbom).ok, false);

    const longRetention = `
      - uses: anchore/sbom-action@v0
        with:
          format: cyclonedx-json
          output-file: resolver-sbom.cdx.json
      - uses: actions/upload-artifact@v4
        with:
          name: resolver-sbom
          path: resolver-sbom.cdx.json
          retention-days: 90
`;
    const check = verifyReleaseSbomConfig(longRetention);
    assert.equal(check.ok, false);
    assert.match(check.violations[0], /retention-days between 1 and 30/);
  });
});
