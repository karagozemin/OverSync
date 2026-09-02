/**
 * CLI wrapper around the deployment manifest validator (issue #234).
 *
 * The rules live in `./lib/deployment-manifest.mjs` so they can be tested
 * without touching the filesystem. This file only finds manifests, parses them,
 * and prints the field-level errors the validator reports.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatManifestError,
  validateDeploymentManifest,
} from "./lib/deployment-manifest.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEPLOYMENT_FILE = /^deployments\.[a-z0-9-]+\.json$/i;

async function deploymentFiles() {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && DEPLOYMENT_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function validateFile(fileName) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(repoRoot, fileName), "utf8"));
  } catch (err) {
    return [`${fileName}:$ must be valid JSON: ${err.message}`];
  }

  const expectedNetwork = basename(fileName, ".json").replace(/^deployments\./, "");
  const { errors } = validateDeploymentManifest(parsed, { expectedNetwork });

  return errors.map((error) => formatManifestError(error, fileName));
}

async function main() {
  const files = await deploymentFiles();
  if (files.length === 0) {
    console.error("No deployment files found. Expected files like deployments.testnet.json.");
    process.exitCode = 1;
    return;
  }

  const errors = [];
  for (const file of files) {
    errors.push(...(await validateFile(file)));
  }

  if (errors.length > 0) {
    console.error("Deployment validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${files.length} deployment file(s): ${files.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
