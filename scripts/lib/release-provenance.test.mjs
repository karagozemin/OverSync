import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

function workflowStep(workflow, name) {
  const lines = workflow.split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => line === `      - name: ${name}`);
  assert.notEqual(start, -1, `expected workflow step "${name}"`);

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("      - "),
  );
  return lines.slice(start, end === -1 ? lines.length : end);
}

describe("release image provenance", () => {
  it("enables max-mode provenance on the image-publishing Buildx step", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const buildStep = workflowStep(workflow, "Build + push").join("\n");

    assert.match(buildStep, /^\s+uses:\s+docker\/build-push-action@v6\s*$/m);
    assert.match(buildStep, /^\s+push:\s*true\s*$/m);
    assert.match(buildStep, /^\s+provenance:\s*mode=max\s*$/m);
  });
});
