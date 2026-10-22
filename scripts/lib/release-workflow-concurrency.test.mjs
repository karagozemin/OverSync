import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

function topLevelConcurrencyBlock(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "concurrency:");
  assert.notEqual(start, -1, "release.yml must declare top-level concurrency");
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(line)) {
      break;
    }
    block.push(line.trim());
  }
  return block;
}

test("release workflow serializes image builds for the same tag", () => {
  const source = readFileSync(workflowPath, "utf8");
  const block = topLevelConcurrencyBlock(source);
  const group = block.find((line) => line.startsWith("group:"));
  const cancel = block.find((line) => line.startsWith("cancel-in-progress:"));

  assert.equal(group, "group: release-${{ github.ref_name }}");
  assert.equal(cancel, "cancel-in-progress: true");
});
