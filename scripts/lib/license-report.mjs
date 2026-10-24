import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * Compact production dependency license report generator (issue #401).
 *
 * Extracts runtime (`dependencies`) entries across all workspace importers in
 * `pnpm-lock.yaml` (excluding `devDependencies`), resolves each package's SPDX
 * license from installed manifests or known workspace metadata, and formats a
 * compact report with a short retention period (default 14 days).
 */

export const DEFAULT_RETENTION_DAYS = 14;
export const MAX_SHORT_RETENTION_DAYS = 30;

/**
 * Fallback SPDX licenses for the committed runtime dependencies when
 * `node_modules` has not been materialized on disk.
 */
const COMMITTED_RUNTIME_LICENSES = Object.freeze({
  "@openzeppelin/contracts": "MIT",
  "@oversync/contracts": "MIT",
  "@oversync/sdk": "MIT",
  "@oversync/stellar": "MIT",
  "@rainbow-me/rainbowkit": "MIT",
  "@stellar/freighter-api": "Apache-2.0",
  "@stellar/stellar-sdk": "Apache-2.0",
  "@tanstack/react-query": "MIT",
  "@types/cors": "MIT",
  "@types/express": "MIT",
  "@types/node": "MIT",
  axios: "MIT",
  clsx: "MIT",
  commander: "MIT",
  cors: "MIT",
  dotenv: "BSD-2-Clause",
  ethers: "MIT",
  express: "MIT",
  "js-sha3": "MIT",
  "lucide-react": "ISC",
  ogl: "MIT",
  pg: "MIT",
  pino: "MIT",
  "pino-http": "MIT",
  "prom-client": "Apache-2.0",
  react: "MIT",
  "react-dom": "MIT",
  "react-router-dom": "MIT",
  relayer: "ISC",
  "tailwind-merge": "MIT",
  typescript: "Apache-2.0",
  viem: "MIT",
  wagmi: "MIT",
  winston: "MIT",
  xstate: "MIT",
  zod: "MIT",
});

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Strips peer-dependency suffixes from a pnpm lockfile version string
 * (for example `2.57.1(typescript@5.9.3)` -> `2.57.1`).
 */
export function normalizeLockedVersion(rawVersion) {
  const clean = stripQuotes(rawVersion);
  const parenIndex = clean.indexOf("(");
  return parenIndex === -1 ? clean : clean.slice(0, parenIndex);
}

/**
 * Parses runtime (`dependencies`) entries from the `importers:` section of
 * `pnpm-lock.yaml`, ignoring `devDependencies`.
 */
export function parseRuntimeImporters(lockfileText) {
  const lines = String(lockfileText).split(/\r?\n/);
  const runtimeEntries = [];

  let inImporters = false;
  let currentImporter = null;
  let currentGroup = null;
  let currentDep = null;
  let currentSpecifier = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^[A-Za-z0-9_-]+:\s*$/.test(rawLine)) {
      const section = rawLine.slice(0, rawLine.indexOf(":")).trim();
      inImporters = section === "importers";
      currentImporter = null;
      currentGroup = null;
      currentDep = null;
      continue;
    }

    if (!inImporters) continue;

    const importerMatch = rawLine.match(/^ {2}([^:\s][^:]*):\s*$/);
    if (importerMatch) {
      currentImporter = stripQuotes(importerMatch[1]);
      currentGroup = null;
      currentDep = null;
      continue;
    }

    const groupMatch = rawLine.match(/^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/);
    if (groupMatch && currentImporter) {
      currentGroup = groupMatch[1];
      currentDep = null;
      continue;
    }

    if (currentGroup !== "dependencies") continue;

    const depMatch = rawLine.match(/^ {6}(.+):\s*$/);
    if (depMatch && currentImporter) {
      currentDep = stripQuotes(depMatch[1]);
      currentSpecifier = null;
      continue;
    }

    const fieldMatch = rawLine.match(/^ {8}(specifier|version):\s*(.+?)\s*$/);
    if (fieldMatch && currentImporter && currentDep) {
      if (fieldMatch[1] === "specifier") {
        currentSpecifier = stripQuotes(fieldMatch[2]);
      } else if (fieldMatch[1] === "version") {
        runtimeEntries.push({
          importer: currentImporter,
          name: currentDep,
          specifier: currentSpecifier ?? "",
          version: normalizeLockedVersion(fieldMatch[2]),
        });
      }
    }
  }

  return runtimeEntries;
}

function normalizeLicenseField(pkgJson) {
  if (!pkgJson || typeof pkgJson !== "object") return null;
  if (typeof pkgJson.license === "string" && pkgJson.license.trim()) {
    return pkgJson.license.trim();
  }
  if (pkgJson.license && typeof pkgJson.license.type === "string") {
    return pkgJson.license.type.trim();
  }
  if (Array.isArray(pkgJson.licenses) && pkgJson.licenses.length > 0) {
    return pkgJson.licenses
      .map((item) => (typeof item === "string" ? item : item?.type))
      .filter(Boolean)
      .join(" OR ");
  }
  return null;
}

function readPackageLicenseIfPresent(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return normalizeLicenseField(parsed);
  } catch {
    return null;
  }
}

/**
 * Resolves the SPDX license for a runtime dependency from overrides, installed
 * `node_modules` manifests, workspace manifests, or the committed fallback map.
 */
export function resolveRuntimeLicense({
  repoRoot,
  importer,
  name,
  version,
  licenseOverrides = {},
}) {
  if (licenseOverrides[`${name}@${version}`]) {
    return licenseOverrides[`${name}@${version}`];
  }
  if (licenseOverrides[name]) {
    return licenseOverrides[name];
  }

  if (repoRoot) {
    if (version.startsWith("link:")) {
      const relTarget = version.slice("link:".length).replace(/\\/g, "/");
      const workspaceDir =
        importer === "." ? relTarget : posix.normalize(`${importer}/${relTarget}`);
      const wsLicense =
        readPackageLicenseIfPresent(join(repoRoot, workspaceDir, "package.json")) ??
        readPackageLicenseIfPresent(join(repoRoot, "package.json"));
      if (wsLicense) return wsLicense;
    }

    const importerDir = importer === "." ? repoRoot : join(repoRoot, importer);
    const directManifest = join(importerDir, "node_modules", name, "package.json");
    const rootManifest = join(repoRoot, "node_modules", name, "package.json");
    const installed =
      readPackageLicenseIfPresent(directManifest) ??
      readPackageLicenseIfPresent(rootManifest);
    if (installed) return installed;
  }

  return COMMITTED_RUNTIME_LICENSES[name] ?? "UNKNOWN";
}

/**
 * Generates a compact production dependency license report with short artifact
 * retention metadata.
 */
export function generateProductionLicenseReport({
  lockfileText,
  repoRoot = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  licenseOverrides = {},
}) {
  const days = Number(retentionDays);
  if (!Number.isInteger(days) || days < 1 || days > MAX_SHORT_RETENTION_DAYS) {
    throw new Error(
      `retentionDays must be an integer between 1 and ${MAX_SHORT_RETENTION_DAYS}; got ${retentionDays}`,
    );
  }

  const rawEntries = parseRuntimeImporters(lockfileText);
  const byKey = new Map();

  for (const entry of rawEntries) {
    const key = `${entry.name}@${entry.version}`;
    if (!byKey.has(key)) {
      const license = resolveRuntimeLicense({
        repoRoot,
        importer: entry.importer,
        name: entry.name,
        version: entry.version,
        licenseOverrides,
      });
      byKey.set(key, {
        name: entry.name,
        version: entry.version,
        license,
        workspaces: new Set([entry.importer]),
      });
    } else {
      byKey.get(key).workspaces.add(entry.importer);
    }
  }

  const dependencies = [...byKey.values()]
    .map((item) => ({
      name: item.name,
      version: item.version,
      license: item.license,
      workspaces: [...item.workspaces].sort(),
    }))
    .sort((a, b) =>
      a.name === b.name
        ? a.version.localeCompare(b.version)
        : a.name.localeCompare(b.name),
    );

  const licenseSummary = {};
  for (const dep of dependencies) {
    licenseSummary[dep.license] = (licenseSummary[dep.license] ?? 0) + 1;
  }

  const sortedSummary = Object.fromEntries(
    Object.entries(licenseSummary).sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    schemaVersion: 1,
    scope: "production",
    retentionDays: days,
    totalPackages: dependencies.length,
    licenseSummary: sortedSummary,
    dependencies,
  };
}

/**
 * Formats a compact Markdown summary from a production dependency license report.
 */
export function formatCompactLicenseMarkdown(report) {
  const summaryParts = Object.entries(report.licenseSummary).map(
    ([lic, count]) => `${lic}: ${count}`,
  );
  const lines = [
    "## Production Dependency License Report",
    "",
    `- **Scope:** ${report.scope} (runtime dependencies only)`,
    `- **Retention Period:** ${report.retentionDays} days`,
    `- **Total Runtime Packages:** ${report.totalPackages}`,
    `- **License Counts:** ${summaryParts.join(", ") || "none"}`,
  ];
  return `${lines.join("\n")}\n`;
}
