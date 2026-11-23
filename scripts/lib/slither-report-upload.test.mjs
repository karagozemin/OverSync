import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function workflowStep(workflow, name) {
  const lines = workflow.split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  assert.notEqual(start, -1, `expected workflow step "${name}"`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("      - "));
  return lines.slice(start, end === -1 ? lines.length : end);
}

describe("Slither report upload", () => {
  it("uploads under always() and warns when the report is missing", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/contracts.yml"), "utf8");

    const check = workflowStep(workflow, "Check Slither report before upload");
    assert.ok(check.some((line) => line.trim() === "if: always()"));
    assert.ok(check.some((line) => line.includes("slither-results.json")));
    assert.ok(check.some((line) => line.includes("::warning")));

    const upload = workflowStep(workflow, "Upload Slither report");
    assert.ok(upload.some((line) => line.trim() === "if: always()"));
    assert.ok(upload.some((line) => line.trim() === "if-no-files-found: warn"));
    assert.ok(upload.some((line) => line.trim() === "path: contracts/slither-results.json"));

    const checkAt = workflow.indexOf("- name: Check Slither report before upload");
    const uploadAt = workflow.indexOf("- name: Upload Slither report");
    assert.ok(checkAt > 0 && uploadAt > checkAt);
  });
});
