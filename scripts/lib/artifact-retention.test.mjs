import test from "node:test";
import assert from "node:assert/strict";
import { findArtifactRetentionViolations } from "./artifact-retention.mjs";

test("flags an evidence upload with no retention-days", () => {
  const yaml = `
    steps:
      - name: Upload CI evidence summary
        uses: actions/upload-artifact@v4
        with:
          name: ci-evidence-summary-typescript
          path: evidence-summary.md
  `;
  const violations = findArtifactRetentionViolations(yaml, "ci.yml");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].artifactName, "ci-evidence-summary-typescript");
  assert.equal(violations[0].reason, "missing retention-days");
});

test("flags a slither upload with no retention-days", () => {
  const yaml = `
    steps:
      - name: Upload Slither report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: slither-report
          path: contracts/slither-results.json
  `;
  const violations = findArtifactRetentionViolations(yaml, "contracts.yml");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].artifactName, "slither-report");
});

test("accepts an evidence upload with a bounded retention-days value", () => {
  const yaml = `
    steps:
      - name: Upload CI evidence summary
        uses: actions/upload-artifact@v4
        with:
          name: ci-evidence-summary-soroban
          path: evidence-summary.md
          retention-days: 14
  `;
  assert.deepEqual(findArtifactRetentionViolations(yaml, "ci.yml"), []);
});

test("rejects a retention-days value that isn't a bounded positive integer", () => {
  const yaml = `
    steps:
      - name: Upload Slither report
        uses: actions/upload-artifact@v4
        with:
          name: slither-report
          path: contracts/slither-results.json
          retention-days: 0
  `;
  const violations = findArtifactRetentionViolations(yaml, "contracts.yml");
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /must be an integer between/);
});

test("ignores upload-artifact steps unrelated to evidence or Slither", () => {
  const yaml = `
    steps:
      - name: Upload build output
        uses: actions/upload-artifact@v4
        with:
          name: frontend-build
          path: frontend/dist
  `;
  assert.deepEqual(findArtifactRetentionViolations(yaml, "ci.yml"), []);
});

test("catches a future evidence upload step added anywhere in the file", () => {
  const yaml = `
    steps:
      - name: Build
        run: pnpm build

      - name: Upload build output
        uses: actions/upload-artifact@v4
        with:
          name: frontend-build
          path: frontend/dist

      - name: Upload new evidence bundle
        uses: actions/upload-artifact@v4
        with:
          name: evidence-bundle-contracts
          path: evidence-bundle.md
  `;
  const violations = findArtifactRetentionViolations(yaml, "ci.yml");
  assert.equal(violations.length, 1);
  assert.equal(violations[0].artifactName, "evidence-bundle-contracts");
});

test("ignores non-upload-artifact steps entirely", () => {
  const yaml = `
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Run Slither
        run: slither contracts/v2
  `;
  assert.deepEqual(findArtifactRetentionViolations(yaml, "contracts.yml"), []);
});
