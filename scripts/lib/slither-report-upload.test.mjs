import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  DEFAULT_SLITHER_REPORT_PATH,
  inspectSlitherReportFile,
  validateSlitherUploadWorkflowPolicy,
} from "./slither-report-upload.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/contracts.yml");
const cliScript = resolve(repoRoot, "scripts/check-slither-report-upload.mjs");

describe("Slither report upload on failure and missing-report diagnostic", () => {
  it("verifies that contracts.yml guards the Slither upload step with if: always()", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const result = validateSlitherUploadWorkflowPolicy(workflowText);

    assert.equal(result.ok, true, `unexpected errors: ${result.violations.join("; ")}`);
    assert.equal(result.policy.ifCondition, "always()");
    assert.equal(result.policy.path, DEFAULT_SLITHER_REPORT_PATH);
  });

  it("rejects workflows without an always() upload guard or with if-no-files-found: error", () => {
    const withoutAlways = [
      "jobs:",
      "  slither:",
      "    steps:",
      "      - name: Upload Slither report",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      "          name: slither-report",
      "          path: contracts/slither-results.json",
    ].join("\n");

    const checkMissingGuard = validateSlitherUploadWorkflowPolicy(withoutAlways);
    assert.equal(checkMissingGuard.ok, false);
    assert.match(checkMissingGuard.violations[0], /must use an always\(\) guard/);

    const withErrorOnMissing = [
      "jobs:",
      "  slither:",
      "    steps:",
      "      - name: Upload Slither report",
      "        uses: actions/upload-artifact@v4",
      "        if: always()",
      "        with:",
      "          name: slither-report",
      "          path: contracts/slither-results.json",
      "          if-no-files-found: error",
    ].join("\n");

    const checkErrorSetting = validateSlitherUploadWorkflowPolicy(withErrorOnMissing);
    assert.equal(checkErrorSetting.ok, false);
    assert.match(checkErrorSetting.violations[0], /if-no-files-found: error/);
  });

  it("marks valid Slither JSON reports ready for upload even when analysis fails", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oversync-slither-upload-"));
    try {
      const reportFile = join(tmp, "slither-results.json");
      writeFileSync(
        reportFile,
        JSON.stringify({
          success: false,
          results: { detectors: [{ check: "reentrancy-eth" }] },
        }),
        "utf8",
      );

      const res = inspectSlitherReportFile(reportFile, {
        analysisOutcome: "failure",
      });
      assert.equal(res.exists, true);
      assert.equal(res.uploadReady, true);
      assert.equal(res.preserveAnalysisResult, true);
      assert.equal(res.detectorCount, 1);
      assert.match(res.diagnostic, /1 detector finding\(s\), analysis outcome: failure/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("emits a clear diagnostic without masking the analysis result when the report file is missing", () => {
    const missingPath = join(tmpdir(), "nonexistent-slither-results.json");
    const res = inspectSlitherReportFile(missingPath, {
      analysisOutcome: "failure",
    });

    assert.equal(res.exists, false);
    assert.equal(res.uploadReady, false);
    assert.equal(res.preserveAnalysisResult, true);
    assert.match(res.diagnostic, /Slither JSON report not found/);
    assert.match(res.diagnostic, /upstream analysis result is not masked/);
  });

  it("executes the CLI check and wires check:slither-report-upload into package.json", () => {
    const missingPath = join(tmpdir(), "nonexistent-slither-results.json");
    const run = spawnSync(
      process.execPath,
      [cliScript, "--report", missingPath, "--outcome", "failure"],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Verified Slither report upload guard \(if: always\(\)/);
    assert.match(run.stdout, /Slither JSON report not found/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:slither-report-upload"],
      "node scripts/check-slither-report-upload.mjs",
    );
  });
});
