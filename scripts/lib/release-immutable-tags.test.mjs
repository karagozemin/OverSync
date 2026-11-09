import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { validateReleaseContainerTags } from "./release-immutable-tags.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");

describe("immutable release container tags", () => {
  it("retains immutable version tags and avoids un-gated mutable major-only or latest tags", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateReleaseContainerTags(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.ok(result.rules.includes("type=ref,event=tag"));
    assert.ok(result.rules.includes("type=semver,pattern={{version}}"));
  });

  it("rejects un-gated type=semver,pattern={{major}} rules or missing immutable version tags", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const withMutableMajor = workflow.replace(
      "type=semver,pattern={{major}}.{{minor}}",
      "type=semver,pattern={{major}}.{{minor}}\n            type=semver,pattern={{major}}",
    );
    const res1 = validateReleaseContainerTags(withMutableMajor);
    assert.equal(res1.ok, false);
    assert.ok(
      res1.violations.some((v) =>
        v.includes("publishes a mutable major-only tag"),
      ),
    );

    const withoutVersion = workflow.replace(
      "            type=semver,pattern={{version}}\n",
      "",
    );
    const res2 = validateReleaseContainerTags(withoutVersion);
    assert.equal(res2.ok, false);
    assert.ok(
      res2.violations.some((v) =>
        v.includes('must retain immutable version tag rule "type=semver,pattern={{version}}"'),
      ),
    );
  });
});
