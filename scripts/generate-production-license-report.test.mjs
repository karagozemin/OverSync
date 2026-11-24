import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectProductionLicenses,
  formatProductionLicenseReport,
} from "./generate-production-license-report.mjs";

test("reports unique external production packages, including transitive dependencies", () => {
  const workspaces = [
    {
      path: "/repo",
      devDependencies: {
        devOnly: { path: "/store/dev-only", version: "1.0.0" },
      },
      dependencies: {
        internal: {
          path: "/repo/sdk",
          version: "1.0.0",
          dependencies: { alpha: { path: "/store/alpha", version: "2.0.0" } },
        },
        alpha: { path: "/store/alpha", version: "2.0.0" },
      },
    },
    {
      path: "/repo/sdk",
      dependencies: {
        beta: {
          path: "/store/beta",
          version: "3.0.0",
          dependencies: {
            alpha: { path: "/store/alpha", version: "2.0.0" },
          },
        },
      },
    },
  ];
  const licenses = { "/store/alpha": "MIT", "/store/beta": "Apache-2.0" };
  const packages = collectProductionLicenses(
    workspaces,
    (path) => licenses[path],
  );
  assert.deepEqual(packages, [
    { name: "alpha", version: "2.0.0", license: "MIT" },
    { name: "beta", version: "3.0.0", license: "Apache-2.0" },
  ]);
  const report = formatProductionLicenseReport(packages);
  assert.match(report, /External packages: 2/);
  assert.match(report, /\| alpha \| 2\.0\.0 \| MIT \|/);
  assert.match(report, /\| Apache-2\.0 \| 1 \|/);
  assert.doesNotMatch(report, /internal/);
  assert.doesNotMatch(report, /devOnly/);
});

test("rejects an empty or incomplete production graph", () => {
  assert.throws(
    () => collectProductionLicenses([], () => "MIT"),
    /no workspace dependency graph/,
  );
  assert.throws(
    () =>
      collectProductionLicenses(
        [{ path: "/repo", dependencies: {} }],
        () => "MIT",
      ),
    /No production dependencies/,
  );
  assert.throws(
    () =>
      collectProductionLicenses(
        [{ path: "/repo", dependencies: { bad: { version: "1" } } }],
        () => "MIT",
      ),
    /Missing installed package path/,
  );
});

test("CI uploads the generated report with 14-day retention", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /run: node scripts\/generate-production-license-report\.mjs/,
  );
  assert.match(
    workflow,
    /name: production-dependency-license-report\n\s+path: tmp\/production-dependency-licenses\.md\n\s+retention-days: 14/,
  );
});
