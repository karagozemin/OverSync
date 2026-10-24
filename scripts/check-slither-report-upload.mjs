#!/usr/bin/env node
/**
 * Validates the `always()` guard and missing-report diagnostic behavior for the
 * Slither report upload step in `.github/workflows/contracts.yml` (issue #386).
 *
 * Usage:
 *   node scripts/check-slither-report-upload.mjs [--report contracts/slither-results.json]
 *   pnpm check:slither-report-upload
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectSlitherReportFile,
  validateSlitherUploadWorkflowPolicy,
} from "./lib/slither-report-upload.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");

function parseArgs(argv) {
  let reportPath = null;
  let analysisOutcome = process.env.SLITHER_OUTCOME || "success";

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--report" && argv[i + 1]) {
      reportPath = resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (argv[i].startsWith("--report=")) {
      reportPath = resolve(process.cwd(), argv[i].slice("--report=".length));
    } else if (argv[i] === "--outcome" && argv[i + 1]) {
      analysisOutcome = argv[i + 1];
      i += 1;
    }
  }

  return { reportPath, analysisOutcome };
}

const { reportPath, analysisOutcome } = parseArgs(process.argv.slice(2));
const workflowText = readFileSync(workflowPath, "utf8");
const workflowCheck = validateSlitherUploadWorkflowPolicy(workflowText);

if (!workflowCheck.ok) {
  console.error("Slither report upload policy check failed:");
  for (const violation of workflowCheck.violations) {
    console.error(`  - ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Verified Slither report upload guard (if: ${workflowCheck.policy.ifCondition}, path: ${workflowCheck.policy.path}).`,
  );
  if (reportPath) {
    const inspection = inspectSlitherReportFile(reportPath, { analysisOutcome });
    console.log(inspection.diagnostic);
  }
}
