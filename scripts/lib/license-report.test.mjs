import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  DEFAULT_RETENTION_DAYS,
  formatCompactLicenseMarkdown,
  generateProductionLicenseReport,
} from "./license-report.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/generate-license-report.mjs");

describe("production dependency license report", () => {
  it("generates a compact runtime-only license report for the workspace lockfile", () => {
    const lockfileText = readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8");
    const report = generateProductionLicenseReport({ lockfileText, repoRoot });

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.scope, "production");
    assert.equal(report.retentionDays, DEFAULT_RETENTION_DAYS);
    assert.ok(report.totalPackages >= 25, `expected >= 25 runtime packages, got ${report.totalPackages}`);

    const names = new Set(report.dependencies.map((d) => d.name));
    assert.ok(names.has("@openzeppelin/contracts"));
    assert.ok(names.has("@stellar/stellar-sdk"));
    assert.ok(names.has("viem"));

    // Dev-only tools must never appear in the production report
    for (const devOnly of ["vitest", "hardhat", "eslint", "prettier", "supertest", "jsdom"]) {
      assert.equal(names.has(devOnly), false, `devDependency "${devOnly}" must be excluded`);
    }

    for (const dep of report.dependencies) {
      assert.notEqual(dep.license, "UNKNOWN", `${dep.name}@${dep.version} has UNKNOWN license`);
      assert.ok(dep.workspaces.length >= 1);
    }
  });

  it("deduplicates shared runtime packages across workspaces and excludes devDependencies", () => {
    const sampleLock = [
      "lockfileVersion: '6.0'",
      "importers:",
      "  coordinator:",
      "    dependencies:",
      "      pino:",
      "        specifier: ^9.5.0",
      "        version: 9.14.0",
      "    devDependencies:",
      "      vitest:",
      "        specifier: ^2.1.0",
      "        version: 2.1.9(@types/node@22.20.4)",
      "  resolver:",
      "    dependencies:",
      "      pino:",
      "        specifier: ^9.5.0",
      "        version: 9.14.0",
    ].join("\n");

    const report = generateProductionLicenseReport({
      lockfileText: sampleLock,
      retentionDays: 7,
      licenseOverrides: { pino: "MIT" },
    });

    assert.equal(report.retentionDays, 7);
    assert.equal(report.totalPackages, 1);
    assert.deepEqual(report.dependencies, [
      {
        name: "pino",
        version: "9.14.0",
        license: "MIT",
        workspaces: ["coordinator", "resolver"],
      },
    ]);
  });

  it("enforces a bounded short retention period (1–30 days)", () => {
    const sampleLock = "lockfileVersion: '6.0'\nimporters:\n  .:\n    dependencies: {}\n";
    assert.throws(() =>
      generateProductionLicenseReport({ lockfileText: sampleLock, retentionDays: 0 }),
    );
    assert.throws(() =>
      generateProductionLicenseReport({ lockfileText: sampleLock, retentionDays: 90 }),
    );
  });

  it("formats a compact Markdown section and writes JSON from the CLI", () => {
    const tmp = mkdtempSync(join(tmpdir(), "oversync-license-report-"));
    try {
      const outFile = join(tmp, "license-report.json");
      const res = spawnSync(
        process.execPath,
        [cliScript, "--out", outFile, "--retention-days", "14"],
        { encoding: "utf8" },
      );
      assert.equal(res.status, 0, res.stderr);

      const written = JSON.parse(readFileSync(outFile, "utf8"));
      assert.equal(written.scope, "production");
      assert.equal(written.retentionDays, 14);

      const md = formatCompactLicenseMarkdown(written);
      assert.match(md, /Production Dependency License Report/);
      assert.match(md, /Retention Period:\*\* 14 days/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("wires license:report into package.json and CI evidence generation", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["license:report"], "node scripts/generate-license-report.mjs");

    const evidenceScript = readFileSync(
      resolve(repoRoot, "scripts/generate-ci-evidence.mjs"),
      "utf8",
    );
    assert.match(evidenceScript, /generateProductionLicenseReport/);
  });
});
