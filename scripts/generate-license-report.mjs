#!/usr/bin/env node
/**
 * Generates a compact production dependency license report (issue #401).
 *
 * Usage:
 *   node scripts/generate-license-report.mjs [--out license-report.json] [--retention-days 14]
 *   pnpm license:report
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RETENTION_DAYS,
  generateProductionLicenseReport,
} from "./lib/license-report.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function parseArgs(argv) {
  let outPath = process.env.LICENSE_REPORT_PATH ?? "license-report.json";
  let retentionDays = Number(
    process.env.LICENSE_REPORT_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS,
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) {
      outPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--out=")) {
      outPath = arg.slice("--out=".length);
    } else if (arg === "--retention-days" && argv[i + 1]) {
      retentionDays = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith("--retention-days=")) {
      retentionDays = Number(arg.slice("--retention-days=".length));
    }
  }

  return { outPath: resolve(process.cwd(), outPath), retentionDays };
}

const { outPath, retentionDays } = parseArgs(process.argv.slice(2));
const lockfileText = readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8");
const report = generateProductionLicenseReport({
  lockfileText,
  repoRoot,
  retentionDays,
});

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(
  `Generated production dependency license report (${report.totalPackages} runtime packages, retention=${report.retentionDays}d) at ${outPath}`,
);
