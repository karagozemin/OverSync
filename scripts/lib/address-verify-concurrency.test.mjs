import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { validateAddressVerifyConcurrency } from "./address-verify-concurrency.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(
  repoRoot,
  ".github/workflows/address-verify.yml",
);

describe("address-verify workflow concurrency cancellation", () => {
  it("declares a ref-scoped concurrency group with cancel-in-progress: true", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateAddressVerifyConcurrency(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.equal(
      result.concurrency?.group,
      "${{ github.workflow }}-${{ github.ref }}",
    );
    assert.equal(result.concurrency?.cancelInProgress, "true");
  });

  it("rejects workflows without concurrency or with cancel-in-progress disabled", () => {
    const missing = validateAddressVerifyConcurrency("name: address-verify\njobs:\n  verify:\n");
    assert.equal(missing.ok, false);
    assert.match(missing.violations[0], /must declare top-level concurrency/);

    const noCancel = validateAddressVerifyConcurrency(
      "name: address-verify\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: false\n",
    );
    assert.equal(noCancel.ok, false);
    assert.ok(
      noCancel.violations.some((v) => v.includes("cancel-in-progress must be true")),
    );
  });
});
