import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Paths that must trigger contracts.yml so frozen installs stay covered. */
const REQUIRED_PATHS = [
  "contracts/**",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".github/workflows/contracts.yml",
];

/**
 * Collect quoted path entries under the first `paths:` block that follows
 * `push:` or `pull_request:` in the workflow YAML.
 */
function pathFilterEntries(workflow, event) {
  const eventAt = workflow.indexOf(`\n  ${event}:`);
  assert.ok(eventAt >= 0, `${event} trigger is missing`);
  const afterEvent = workflow.slice(eventAt);
  const pathsAt = afterEvent.search(/\n {4}paths:\n/);
  assert.ok(pathsAt >= 0, `${event} paths filter is missing`);
  const pathsBlock = afterEvent.slice(pathsAt + "\n    paths:\n".length);
  const entries = [];
  for (const line of pathsBlock.split(/\r?\n/)) {
    const match = line.match(/^ {6}- '([^']+)'\s*$/);
    if (!match) break;
    entries.push(match[1]);
  }
  return entries;
}

describe("contracts workflow path filters", () => {
  it("runs when the root lockfile or package manifests change", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/contracts.yml"), "utf8");
    for (const event of ["push", "pull_request"]) {
      const paths = pathFilterEntries(workflow, event);
      for (const required of REQUIRED_PATHS) {
        assert.ok(
          paths.includes(required),
          `${event} paths must include '${required}'; got ${JSON.stringify(paths)}`,
        );
      }
    }
  });
});
