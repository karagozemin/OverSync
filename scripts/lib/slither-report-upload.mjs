import { existsSync, readFileSync } from "node:fs";

/**
 * Slither report `always()` upload policy validator and missing-report
 * diagnostic helper (issue #386).
 *
 * Ensures `.github/workflows/contracts.yml` guards the Slither artifact upload
 * step with `if: always()` so reports are uploaded even when Slither fails, and
 * emits a clear diagnostic when `contracts/slither-results.json` is absent
 * rather than masking the analysis result.
 */

export const DEFAULT_SLITHER_REPORT_PATH = "contracts/slither-results.json";

/**
 * Extracts the `Upload Slither report` step from `.github/workflows/contracts.yml`.
 */
export function extractSlitherUploadPolicy(workflowText) {
  const source = String(workflowText ?? "");
  const stepMatch = source.match(
    /- name:\s*Upload Slither report[\s\S]*?(?=\n {6}- |\n {2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!stepMatch) {
    return null;
  }

  const block = stepMatch[0];
  const usesMatch = block.match(/uses:\s*([^\r\n]+)/);
  const ifMatch = block.match(/^\s*if:\s*([^\r\n]+)/m);
  const nameMatch = block.match(/^\s*name:\s*(slither-report[^\r\n]*)/m);
  const pathMatch = block.match(/^\s*path:\s*([^\r\n]+)/m);
  const noFilesMatch = block.match(/^\s*if-no-files-found:\s*([^\r\n]+)/m);

  return {
    uses: usesMatch ? usesMatch[1].trim() : null,
    ifCondition: ifMatch ? ifMatch[1].trim() : null,
    artifactName: nameMatch ? nameMatch[1].trim() : null,
    path: pathMatch ? pathMatch[1].trim() : null,
    ifNoFilesFound: noFilesMatch ? noFilesMatch[1].trim() : "warn",
  };
}

/**
 * Validates that `.github/workflows/contracts.yml` uploads the Slither report
 * under an `always()` guard and does not mask analysis failures when the report
 * file is missing.
 */
export function validateSlitherUploadWorkflowPolicy(workflowText) {
  const policy = extractSlitherUploadPolicy(workflowText);
  const violations = [];

  if (!policy) {
    return {
      ok: false,
      policy: null,
      violations: ["contracts.yml is missing the Upload Slither report step"],
    };
  }

  if (!policy.uses || !/^actions\/upload-artifact@v\d+$/.test(policy.uses)) {
    violations.push("Upload Slither report step must use actions/upload-artifact");
  }

  if (!policy.ifCondition || !/\balways\s*\(\s*\)/.test(policy.ifCondition)) {
    violations.push(
      `Upload Slither report step must use an always() guard so reports upload when analysis fails (got "${policy.ifCondition ?? "none"}")`,
    );
  }

  if (policy.path !== DEFAULT_SLITHER_REPORT_PATH) {
    violations.push(
      `Upload Slither report step path must be "${DEFAULT_SLITHER_REPORT_PATH}" (got "${policy.path ?? "none"}")`,
    );
  }

  if (policy.ifNoFilesFound === "error") {
    violations.push(
      'Upload Slither report step must not set if-no-files-found: error, which would mask an upstream compilation/analysis failure',
    );
  }

  return {
    ok: violations.length === 0,
    policy,
    violations,
  };
}

/**
 * Inspects the Slither JSON report before artifact upload and produces a clear,
 * non-masking diagnostic when the file is missing or unreadable.
 */
export function inspectSlitherReportFile(reportPath, options = {}) {
  const analysisOutcome = options.analysisOutcome ?? "success";

  if (!existsSync(reportPath)) {
    return {
      exists: false,
      uploadReady: false,
      analysisOutcome,
      preserveAnalysisResult: true,
      detectorCount: 0,
      diagnostic: `Slither JSON report not found at "${reportPath}" (analysis outcome: ${analysisOutcome}); skipping artifact upload with a warning so the upstream analysis result is not masked.`,
    };
  }

  try {
    const raw = readFileSync(reportPath, "utf8");
    const parsed = JSON.parse(raw);
    const detectors = Array.isArray(parsed?.results?.detectors)
      ? parsed.results.detectors
      : [];

    return {
      exists: true,
      uploadReady: true,
      analysisOutcome,
      preserveAnalysisResult: true,
      detectorCount: detectors.length,
      diagnostic: `Slither JSON report ready for upload at "${reportPath}" (${detectors.length} detector finding(s), analysis outcome: ${analysisOutcome}).`,
    };
  } catch (err) {
    return {
      exists: true,
      uploadReady: false,
      analysisOutcome,
      preserveAnalysisResult: true,
      detectorCount: 0,
      diagnostic: `Slither JSON report at "${reportPath}" is not valid JSON (${err.message}); preserving upstream analysis outcome (${analysisOutcome}).`,
    };
  }
}
