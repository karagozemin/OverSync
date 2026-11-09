import { existsSync, statSync } from "node:fs";

/**
 * Validates that the Slither job in `.github/workflows/contracts.yml` uploads
 * its JSON report under an `if: always()` guard and emits a clear diagnostic
 * when the report file is missing without masking the analysis result
 * (issue #386).
 */

export const SLITHER_REPORT_PATH = "contracts/slither-results.json";

export function diagnoseSlitherReport({
  reportPath = SLITHER_REPORT_PATH,
  exists = existsSync,
  stat = statSync,
} = {}) {
  if (!exists(reportPath)) {
    return {
      present: false,
      diagnostic: `Slither report not found at "${reportPath}". An earlier build or Slither step failed before writing the JSON report; check the preceding step logs for the root cause.`,
    };
  }

  const info = stat(reportPath);
  if (!info || info.size === 0) {
    return {
      present: false,
      diagnostic: `Slither report at "${reportPath}" is empty (0 bytes). Check the Slither execution output for the underlying failure.`,
    };
  }

  return {
    present: true,
    diagnostic: `Slither report ready for upload: "${reportPath}" (${info.size} bytes).`,
  };
}

function extractStepBlock(workflowText, stepName) {
  const lines = String(workflowText ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s{6}-\s+/.test(lines[i]) || /^\s{2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function validateSlitherReportUpload(workflowText) {
  const violations = [];
  const uploadBlock = extractStepBlock(workflowText, "Upload Slither report");

  if (!uploadBlock) {
    violations.push('contracts.yml is missing step "Upload Slither report"');
    return { ok: false, violations };
  }

  if (!/^\s*if:\s*always\(\)\s*$/m.test(uploadBlock)) {
    violations.push('"Upload Slither report" must declare if: always()');
  }

  if (!/^\s*path:\s*contracts\/slither-results\.json\s*$/m.test(uploadBlock)) {
    violations.push(
      '"Upload Slither report" must upload path: contracts/slither-results.json',
    );
  }

  const ifNoFilesMatch = uploadBlock.match(/^\s*if-no-files-found:\s*(\S+)\s*$/m);
  if (!ifNoFilesMatch) {
    violations.push(
      '"Upload Slither report" must explicitly set if-no-files-found: warn so missing reports emit a warning without masking the analysis result',
    );
  } else if (ifNoFilesMatch[1] !== "warn") {
    violations.push(
      `"Upload Slither report" if-no-files-found must be "warn" (got "${ifNoFilesMatch[1]}") so missing reports neither fail the upload step nor fail silently`,
    );
  }

  const diagBlock = extractStepBlock(
    workflowText,
    "Check Slither report before upload",
  );
  if (!diagBlock) {
    violations.push(
      'contracts.yml must include step "Check Slither report before upload" before uploading the artifact',
    );
  } else {
    if (!/^\s*if:\s*always\(\)\s*$/m.test(diagBlock)) {
      violations.push(
        '"Check Slither report before upload" must declare if: always()',
      );
    }
    if (!diagBlock.includes("slither-results.json")) {
      violations.push(
        '"Check Slither report before upload" must inspect contracts/slither-results.json',
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
