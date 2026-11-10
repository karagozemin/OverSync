import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  parseReleaseMetadataTagRules,
  validateReleaseContainerTagPolicy,
} from "./release-immutable-tags.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

describe("release container tag immutability policy (#403)", () => {
  it("retains immutable version tags and gates any major-only tag in release.yml", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateReleaseContainerTagPolicy(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected tag policy violations: ${result.violations.join("; ")}`,
    );
    assert.ok(result.rules.includes("type=ref,event=tag"));
    assert.ok(result.rules.includes("type=semver,pattern={{version}}"));
  });

  it("rejects workflows that unconditionally publish mutable major-only tags", () => {
    const unsafeWorkflow = `
      - name: Extract metadata
        uses: docker/metadata-action@v5
        with:
          tags: |
            type=ref,event=tag
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}
`;
    const result = validateReleaseContainerTagPolicy(unsafeWorkflow);
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /unconditional mutable major-only tag/);
  });

  it("parses metadata tag rules cleanly", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const rules = parseReleaseMetadataTagRules(workflow);
    assert.ok(rules.length >= 3);
  });
});
