import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Generates a compact runtime dependency license report across the root and
 * workspace manifests and validates that CI uploads it with a short retention
 * period (issue #401).
 */

export function resolveWorkspaces(repoRoot, rootManifest) {
  return (rootManifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    const parentAbs = join(repoRoot, parent);
    if (!existsSync(parentAbs)) return [];
    return readdirSync(parentAbs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

function readInstalledPackageMeta(repoRoot, workspaceDir, depName) {
  const candidates = [
    join(repoRoot, workspaceDir, "node_modules", depName, "package.json"),
    join(repoRoot, "node_modules", depName, "package.json"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      const license =
        typeof pkg.license === "string"
          ? pkg.license
          : pkg.license?.type ?? "UNSPECIFIED";
      return {
        installedVersion: pkg.version ?? null,
        license,
      };
    } catch {
      // fall through
    }
  }
  return { installedVersion: null, license: "UNRESOLVED" };
}

export function generateProductionLicenseReport(repoRoot) {
  const rootManifest = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  const dirs = [".", ...resolveWorkspaces(repoRoot, rootManifest)];
  const byPackage = new Map();

  for (const dir of dirs) {
    const manifestPath =
      dir === "."
        ? join(repoRoot, "package.json")
        : join(repoRoot, dir, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const wsName = manifest.name ?? dir;
    const deps = manifest.dependencies ?? {};

    for (const [depName, spec] of Object.entries(deps)) {
      if (
        depName === "relayer" ||
        depName.startsWith("@oversync/") ||
        String(spec).startsWith("workspace:")
      ) {
        continue;
      }
      const meta = readInstalledPackageMeta(repoRoot, dir, depName);
      const existing = byPackage.get(depName) ?? {
        name: depName,
        specs: new Set(),
        workspaces: new Set(),
        installedVersion: meta.installedVersion,
        license: meta.license,
      };
      existing.specs.add(spec);
      existing.workspaces.add(wsName);
      if (!existing.installedVersion && meta.installedVersion) {
        existing.installedVersion = meta.installedVersion;
      }
      if (existing.license === "UNRESOLVED" && meta.license !== "UNRESOLVED") {
        existing.license = meta.license;
      }
      byPackage.set(depName, existing);
    }
  }

  const packages = [...byPackage.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: entry.name,
      version: entry.installedVersion ?? [...entry.specs][0],
      specs: [...entry.specs].sort(),
      license: entry.license,
      workspaces: [...entry.workspaces].sort(),
    }));

  return {
    schemaVersion: 1,
    scope: "production",
    totalRuntimeDependencies: packages.length,
    packages,
  };
}

export function validateLicenseReportWorkflow(workflowText) {
  const violations = [];
  const source = String(workflowText ?? "");

  if (!source.includes("generate-license-report.mjs")) {
    violations.push(
      "ci.yml must run scripts/generate-license-report.mjs to build the production license report",
    );
  }

  const uploadMatch = source.match(
    /- name:\s*Upload production dependency license report[\s\S]*?(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!uploadMatch) {
    violations.push(
      'ci.yml is missing step "Upload production dependency license report"',
    );
    return { ok: false, violations };
  }

  const block = uploadMatch[0];
  const retentionMatch = block.match(/^\s*retention-days:\s*(\d+)\s*$/m);
  if (!retentionMatch) {
    violations.push(
      '"Upload production dependency license report" must set a bounded retention-days',
    );
  } else {
    const days = Number(retentionMatch[1]);
    if (days < 1 || days > 30) {
      violations.push(
        `"Upload production dependency license report" retention-days must be between 1 and 30 (got ${days})`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
