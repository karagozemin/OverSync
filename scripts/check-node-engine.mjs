#!/usr/bin/env node
/**
 * Validates that every workspace `engines.node` range is compatible with the
 * Node version used by CI (issue #395).
 *
 * Usage:   node scripts/check-node-engine.mjs
 * Or:      pnpm check:node-engine
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateNodeEngineMetadata } from "./lib/node-engine-metadata.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Workspace directories from the root manifest, with `dir/*` globs expanded. */
function workspaceDirs(rootManifest) {
  return rootManifest.workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function readWorkspaces() {
  const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const dirs = [".", ...workspaceDirs(rootManifest)];

  return dirs.map((dir) => {
    const path = dir === "." ? "package.json" : `${dir}/package.json`;
    const manifest = JSON.parse(readFileSync(join(repoRoot, path), "utf8"));
    return { path, enginesNode: manifest.engines?.node ?? null };
  });
}

const workspaces = readWorkspaces();
const ciWorkflowText = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const result = validateNodeEngineMetadata({ workspaces, ciWorkflowText });

if (!result.ok) {
  console.error(
    `Node engine validation failed with ${result.violations.length} violation(s):`,
  );
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated Node engine metadata across ${workspaces.length} workspace(s): all lower bounds are compatible with CI node-version ${result.ciNodeMajor}.`,
  );
}
