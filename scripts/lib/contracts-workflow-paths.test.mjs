import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  REQUIRED_CONTRACT_WORKFLOW_PATHS,
  validateContractWorkflowPaths,
} from "./contracts-workflow-paths.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");

describe("contracts workflow path filters", () => {
  it("includes root package.json and pnpm-lock.yaml in both push and pull_request path filters", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const result = validateContractWorkflowPaths(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    for (const p of REQUIRED_CONTRACT_WORKFLOW_PATHS) {
      assert.ok(result.pushPaths.includes(p));
      assert.ok(result.prPaths.includes(p));
    }
  });

  it("flags workflows that omit lockfile or root manifest paths", () => {
    const legacyWorkflow = `name: contracts
on:
  push:
    paths:
      - 'contracts/**'
      - '.github/workflows/contracts.yml'
  pull_request:
    paths:
      - 'contracts/**'
      - '.github/workflows/contracts.yml'
jobs:
  foundry:
    runs-on: ubuntu-latest
`;
    const result = validateContractWorkflowPaths(legacyWorkflow);
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) => v.includes('push.paths is missing required path "pnpm-lock.yaml"')),
    );
    assert.ok(
      result.violations.some((v) => v.includes('pull_request.paths is missing required path "package.json"')),
    );
  });
});
