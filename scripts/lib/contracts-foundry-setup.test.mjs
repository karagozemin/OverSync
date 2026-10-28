import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function jobBlock(workflow, name) {
  const match = workflow.match(new RegExp(` {2}${name}:[\\s\\S]*?(?=\\n {2}[A-Za-z0-9_-]+:|$)`));
  assert.ok(match, `${name} job is missing`);
  return match[0];
}

describe("Slither Foundry setup", () => {
  it("installs Foundry once and checks forge before analysis", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/contracts.yml"), "utf8");
    const slither = jobBlock(workflow, "slither");
    // Actions may be referenced by a version tag or pinned to a commit SHA.
    const setups =
      slither.match(/foundry-rs\/foundry-toolchain@(?:v\d+(?:\.\d+)*|[0-9a-f]{40})/g) ?? [];
    assert.equal(setups.length, 1);
    const versionAt = slither.indexOf("forge --version");
    const analysisAt = slither.indexOf("slither contracts/v2");
    assert.ok(versionAt > 0 && analysisAt > versionAt);
  });
});
