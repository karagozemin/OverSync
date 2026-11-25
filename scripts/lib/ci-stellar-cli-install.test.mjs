import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Soroban Stellar CLI install", () => {
  it("keeps one pinned installation and one version assertion", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const installs = workflow.match(/- name: Install Stellar CLI/g) ?? [];
    const versions = workflow.match(/stellar --version/g) ?? [];
    assert.equal(installs.length, 1);
    assert.equal(versions.length, 1);
    assert.equal(workflow.includes("cargo install --locked stellar-cli"), false);
    assert.match(workflow, /cargo binstall -y stellar-cli --version 22\.8\.1/);
  });
});
