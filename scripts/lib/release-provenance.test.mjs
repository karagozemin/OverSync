import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { validateReleaseProvenance } from "./release-provenance.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

describe("release image provenance attestation", () => {
  it("enables Buildx provenance attestation on the release Build + push step", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateReleaseProvenance(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.equal(result.provenance, "mode=max");
  });

  it("rejects workflows that omit provenance or disable it", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const omitted = workflow.replace(/^\s*provenance:.*$/m, "");
    const res1 = validateReleaseProvenance(omitted);
    assert.equal(res1.ok, false);
    assert.ok(
      res1.violations.some((v) => v.includes("must explicitly enable provenance")),
    );

    const disabled = workflow.replace("provenance: mode=max", "provenance: false");
    const res2 = validateReleaseProvenance(disabled);
    assert.equal(res2.ok, false);
  });
});
