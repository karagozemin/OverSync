import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Soroban CI diagnostics", () => {
  it("does not run the temporary ed25519-dalek cargo tree probe", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    assert.equal(/^\s*run:\s*cargo tree -i ed25519-dalek@3\.0\.0/m.test(workflow), false);
    assert.equal(/^\s*- name: Who needs ed25519-dalek 3\.0\.0/m.test(workflow), false);
    // The ed25519-dalek pin now lives in the committed soroban/Cargo.lock, and CI
    // fails if the lockfile is stale instead of re-resolving it at run time
    // (see cargo-locked.test.mjs for the rule that no workflow runs `cargo update`).
    assert.match(workflow, /^\s*run:\s*cargo metadata --locked\b/m);
  });
});
