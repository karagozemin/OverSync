#!/usr/bin/env node
/** Generate a compact inventory from pnpm's installed production graph. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function collectProductionLicenses(workspaces, readLicense) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error("pnpm returned no workspace dependency graph");
  }

  const workspacePaths = new Set(workspaces.map((workspace) => workspace.path));
  const packages = new Map();

  function visit(dependencies = {}) {
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (!dependency.path || !dependency.version) {
        throw new Error(
          `Missing installed package path or version for ${name}`,
        );
      }
      if (!workspacePaths.has(dependency.path)) {
        const key = `${name}@${dependency.version}`;
        if (!packages.has(key)) {
          const license = readLicense(dependency.path);
          packages.set(key, { name, version: dependency.version, license });
        }
      }
      visit(dependency.dependencies);
    }
  }

  for (const workspace of workspaces) visit(workspace.dependencies);
  if (packages.size === 0) throw new Error("No production dependencies found");
  return [...packages.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

export function formatProductionLicenseReport(packages) {
  const counts = new Map();
  for (const item of packages)
    counts.set(item.license, (counts.get(item.license) ?? 0) + 1);
  const summary = [...counts].sort(([a], [b]) => a.localeCompare(b));
  const rows = packages.map(
    ({ name, version, license }) =>
      `| ${name} | ${version} | ${license.replaceAll("|", "\\|")} |`,
  );
  return [
    "# Production dependency licenses",
    "",
    `External packages: ${packages.length} (unique name and version pairs).`,
    "",
    "| License | Packages |",
    "| --- | ---: |",
    ...summary.map(
      ([license, count]) => `| ${license.replaceAll("|", "\\|")} | ${count} |`,
    ),
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function main() {
  const graph = JSON.parse(
    execFileSync(
      "pnpm",
      ["list", "-r", "--prod", "--depth", "Infinity", "--json"],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    ),
  );
  const packages = collectProductionLicenses(graph, (packagePath) => {
    const { license } = JSON.parse(
      readFileSync(resolve(packagePath, "package.json"), "utf8"),
    );
    return typeof license === "string" && license.trim()
      ? license.trim()
      : "UNKNOWN";
  });
  const outputDir = resolve(ROOT, "tmp");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "production-dependency-licenses.md");
  writeFileSync(outputPath, formatProductionLicenseReport(packages), "utf8");
  console.log(
    `Wrote ${packages.length} production dependency licenses to ${outputPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
