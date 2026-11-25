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

describe("CI evidence diagnostics", () => {
  it("generates and uploads summaries after earlier steps fail in both jobs", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const evidenceSteps = [
      "Generate CI evidence summary",
      "Upload CI evidence summary",
      "Generate CI evidence summary (Soroban)",
      "Upload CI evidence summary (Soroban)",
    ];

    for (const name of evidenceSteps) {
      assert.ok(
        workflowStep(workflow, name).some((line) => line.trim() === "if: always()"),
        `"${name}" must use if: always()`,
      );
    }
  });
});
