import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  diagnoseSlitherReport,
  validateSlitherReportUpload,
} from "./slither-report-upload.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const contractsWorkflowPath = resolve(
  repoRoot,
  ".github/workflows/contracts.yml",
);

describe("Slither report upload and missing-report diagnostic", () => {
  it("guards the Slither report upload with always() and non-masking missing-report diagnostics", () => {
    const workflow = readFileSync(contractsWorkflowPath, "utf8");
    const result = validateSlitherReportUpload(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
  });

  it("rejects workflows missing if: always() or using if-no-files-found: error", () => {
    const workflow = readFileSync(contractsWorkflowPath, "utf8");

    const withoutAlways = workflow.replace(/if:\s*always\(\)/g, "if: success()");
    const res1 = validateSlitherReportUpload(withoutAlways);
    assert.equal(res1.ok, false);
    assert.ok(
      res1.violations.some((v) => v.includes("must declare if: always()")),
    );

    const maskingError = workflow.replace(
      "if-no-files-found: warn",
      "if-no-files-found: error",
    );
    const res2 = validateSlitherReportUpload(maskingError);
    assert.equal(res2.ok, false);
    assert.ok(
      res2.violations.some((v) => v.includes('if-no-files-found must be "warn"')),
    );
  });

  it("produces clear diagnostics for missing, empty, and valid Slither reports", () => {
    const missing = diagnoseSlitherReport({
      reportPath: "contracts/slither-results.json",
      exists: () => false,
    });
    assert.equal(missing.present, false);
    assert.match(missing.diagnostic, /Slither report not found/);

    const empty = diagnoseSlitherReport({
      reportPath: "contracts/slither-results.json",
      exists: () => true,
      stat: () => ({ size: 0 }),
    });
    assert.equal(empty.present, false);
    assert.match(empty.diagnostic, /is empty \(0 bytes\)/);

    const valid = diagnoseSlitherReport({
      reportPath: "contracts/slither-results.json",
      exists: () => true,
      stat: () => ({ size: 512 }),
    });
    assert.equal(valid.present, true);
    assert.match(valid.diagnostic, /512 bytes/);
  });
});
