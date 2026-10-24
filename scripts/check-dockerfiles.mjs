#!/usr/bin/env node
/**
 * Lints `resolver/Dockerfile` and `relayer/Dockerfile` with `.hadolint.yaml`
 * and fails on any high-severity (`error` or `warning`) finding (issue #397).
 *
 * Usage:
 *   node scripts/check-dockerfiles.mjs
 *   pnpm lint:docker
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TARGET_DOCKERFILES,
  lintDockerfile,
  parseHadolintConfig,
  validateHadolintConfig,
} from "./lib/dockerfile-lint.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = resolve(repoRoot, ".hadolint.yaml");
const config = parseHadolintConfig(readFileSync(configPath, "utf8"));
const configCheck = validateHadolintConfig(config);

const errors = [...configCheck.violations];
const blocking = [];

for (const relPath of TARGET_DOCKERFILES) {
  const fullPath = resolve(repoRoot, relPath);
  const dockerfileText = readFileSync(fullPath, "utf8");
  const res = lintDockerfile(dockerfileText, { file: relPath, config });
  blocking.push(...res.blockingFindings);
}

if (errors.length > 0 || blocking.length > 0) {
  console.error("Dockerfile lint failed:");
  for (const err of errors) {
    console.error(`  - [config] ${err}`);
  }
  for (const finding of blocking) {
    console.error(
      `  - ${finding.file}:${finding.line} [${finding.code}/${finding.severity}]: ${finding.message}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Linted ${TARGET_DOCKERFILES.length} Dockerfile(s) (${TARGET_DOCKERFILES.join(", ")}) with .hadolint.yaml (failure-threshold=${config.failureThreshold}): 0 blocking findings.`,
  );
}
