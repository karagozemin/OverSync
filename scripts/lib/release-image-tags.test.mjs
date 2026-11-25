import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function metadataTags(workflow) {
  const match = workflow.match(/\n {10}tags: \|\n((?: {12}.+\n)+)/);
  assert.ok(match, "docker/metadata-action tags block is missing");
  return match[1].split("\n").map((line) => line.trim()).filter(Boolean);
}

describe("release image tags", () => {
  const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  const tags = metadataTags(workflow);

  it("keeps the immutable version tags", () => {
    assert.ok(tags.includes("type=ref,event=tag"));
    assert.ok(tags.includes("type=semver,pattern={{version}}"));
  });

  it("does not publish moving major or major.minor tags", () => {
    for (const tag of tags) {
      assert.doesNotMatch(tag, /\{\{major\}\}|\{\{minor\}\}/, `mutable tag: ${tag}`);
      assert.doesNotMatch(tag, /latest/, `mutable tag: ${tag}`);
    }
  });
});
