#!/usr/bin/env node
/**
 * Generates a compact JSON license report for production/runtime dependencies
 * across the repository (issue #401).
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateProductionLicenseReport } from "./lib/license-report.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outArg = process.argv[2] || "license-report.json";
const outPath = resolve(repoRoot, outArg);

const report = generateProductionLicenseReport(repoRoot);
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Wrote production dependency license report (${report.totalRuntimeDependencies} packages) to ${outArg}`,
);
