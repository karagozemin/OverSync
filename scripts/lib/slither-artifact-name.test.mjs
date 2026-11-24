import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  formatSlitherArtifactName,
  validateSlitherArtifactNaming,
} from "./slither-artifact-name.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");

describe("Slither commit-specific artifact naming (#388)", () => {
  it("includes the short commit SHA in the Slither artifact name in contracts.yml", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateSlitherArtifactNaming(workflow);
    assert.equal(result.ok, true, result.violations.join("; "));
    assert.equal(result.artifactName, "slither-report-${{ steps.sha.outputs.short_sha }}");
  });

  it("formats commit-specific Slither artifact names and rejects invalid SHAs", () => {
    assert.equal(
      formatSlitherArtifactName("7c9fde1234567890abcdef1234567890abcdef12"),
      "slither-report-7c9fde1",
    );
    assert.throws(() => formatSlitherArtifactName("not-a-sha"), /Invalid commit SHA/);
  });

  it("rejects a static slither-report artifact name", () => {
    const workflow = readFileSync(workflowPath, "utf8").replace(
      "name: slither-report-${{ steps.sha.outputs.short_sha }}",
      "name: slither-report",
    );
    const result = validateSlitherArtifactNaming(workflow);
    assert.equal(result.ok, false);
    assert.ok(result.violations.some((item) => item.includes('uses static name "slither-report"')));
  });
});
