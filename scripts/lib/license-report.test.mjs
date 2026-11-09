import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  generateProductionLicenseReport,
  validateLicenseReportWorkflow,
} from "./license-report.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ciWorkflowPath = resolve(repoRoot, ".github/workflows/ci.yml");

describe("production dependency license report", () => {
  it("generates a compact license report covering runtime dependencies only", () => {
    const report = generateProductionLicenseReport(repoRoot);
    assert.equal(report.scope, "production");
    assert.ok(report.totalRuntimeDependencies > 0);
    assert.equal(report.packages.length, report.totalRuntimeDependencies);

    const names = report.packages.map((p) => p.name);
    assert.ok(names.includes("viem"));
    assert.equal(
      names.includes("vitest"),
      false,
      "devDependencies like vitest must not appear in the production license report",
    );
    assert.equal(
      names.some((n) => n.startsWith("@oversync/")),
      false,
      "internal workspace:* packages must be excluded",
    );
  });

  it("wires license report generation and short-retention artifact upload in ci.yml and package.json", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const result = validateLicenseReportWorkflow(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );

    const pkg = JSON.parse(
      readFileSync(resolve(repoRoot, "package.json"), "utf8"),
    );
    assert.equal(
      pkg.scripts["report:licenses"],
      "node scripts/generate-license-report.mjs",
    );
  });

  it("rejects workflows without a bounded short retention period on the license report upload", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8").replace(
      /(- name:\s*Upload production dependency license report[\s\S]*?)retention-days:\s*14/,
      "$1retention-days: 90",
    );
    const result = validateLicenseReportWorkflow(workflow);
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) => v.includes("retention-days must be between 1 and 30")),
    );
  });
});
