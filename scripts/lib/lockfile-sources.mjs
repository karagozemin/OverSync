import { posix } from "node:path";

/**
 * Validates every workspace importer and resolved package entry in
 * `pnpm-lock.yaml` (issue #405).
 *
 * Rejects unreviewed:
 *   - git sources (`git+`, `git://`, `github:`, `gitlab:`, `bitbucket:`, `type: git`)
 *   - URL tarball sources (`http://`, `https://`, `tarball:`)
 *   - local-path sources (`file:`, `link:`, `directory:`), except internal
 *     workspace `link:` references that resolve to a declared workspace
 *     importer in the same lockfile.
 *   - `packages:` entries whose `resolution:` lacks a cryptographic
 *     `integrity: sha(256|384|512)-...` digest.
 */

const GIT_SPEC_RE =
  /^(?:git\+|git:\/\/|github:|gitlab:|bitbucket:|ssh:\/\/git@)|(?:^|[/\s])(?:github\.com|gitlab\.com|bitbucket\.org)\/|\.git(?:#|$)/i;
const URL_TARBALL_RE = /^https?:\/\//i;
const LOCAL_PATH_RE = /^(?:file:|link:|\.\.?\/|\/)/i;
const INTEGRITY_RE = /\bintegrity:\s*sha(?:256|384|512)-[A-Za-z0-9+/=]+/;

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
 * Normalizes a relative `link:` target against its importer directory so
 * internal workspace links (for example `link:../packages/sdk` from
 * `coordinator`) can be matched against declared `importers:` keys.
 */
export function resolveWorkspaceLinkTarget(importerId, linkValue) {
  const rawTarget = linkValue.slice("link:".length).trim().replace(/\\/g, "/");
  if (!rawTarget || rawTarget.startsWith("/")) return null;
  const baseDir = importerId === "." ? "." : importerId.replace(/\\/g, "/");
  const joined = baseDir === "." ? posix.normalize(rawTarget) : posix.normalize(`${baseDir}/${rawTarget}`);
  return joined === "" ? "." : joined;
}

/**
 * Classifies a dependency specifier or resolved version string from an
 * importer entry. Returns `null` when valid, or `{ kind, detail }` when
 * forbidden.
 */
export function classifyImporterSource(importerId, field, rawValue, workspaceImporters) {
  const value = stripQuotes(rawValue);
  if (!value) return null;

  if (value.startsWith("workspace:")) {
    return null;
  }

  if (value.toLowerCase().startsWith("link:")) {
    const target = resolveWorkspaceLinkTarget(importerId, value);
    if (target && workspaceImporters.has(target)) {
      return null;
    }
    return {
      kind: "local-path",
      detail: `${field} "${value}" links outside declared workspace importers`,
    };
  }

  if (GIT_SPEC_RE.test(value)) {
    return {
      kind: "git",
      detail: `${field} "${value}" uses an unreviewed git dependency source`,
    };
  }

  if (URL_TARBALL_RE.test(value)) {
    return {
      kind: "url-tarball",
      detail: `${field} "${value}" uses an unreviewed URL tarball source`,
    };
  }

  if (LOCAL_PATH_RE.test(value)) {
    return {
      kind: "local-path",
      detail: `${field} "${value}" uses an unreviewed local-path source`,
    };
  }

  return null;
}

/**
 * Classifies a resolved `packages:` key and its `resolution:` block.
 */
export function classifyPackageEntry(pkgKey, resolutionLines, line) {
  const cleanKey = stripQuotes(pkgKey);

  if (GIT_SPEC_RE.test(cleanKey)) {
    return {
      kind: "git",
      line,
      entry: cleanKey,
      detail: `package key "${cleanKey}" uses an unreviewed git source`,
    };
  }

  if (URL_TARBALL_RE.test(cleanKey)) {
    return {
      kind: "url-tarball",
      line,
      entry: cleanKey,
      detail: `package key "${cleanKey}" uses an unreviewed URL tarball source`,
    };
  }

  if (/^(?:file:|link:)/i.test(cleanKey)) {
    return {
      kind: "local-path",
      line,
      entry: cleanKey,
      detail: `package key "${cleanKey}" uses an unreviewed local-path source`,
    };
  }

  if (resolutionLines.length === 0) {
    return {
      kind: "missing-integrity",
      line,
      entry: cleanKey,
      detail: `package "${cleanKey}" is missing a resolution block`,
    };
  }

  const combined = resolutionLines.map((item) => item.text).join(" ");
  const resLine = resolutionLines[0].line;

  if (/\btype:\s*git\b|\brepo:\s*\S+|\bcommit:\s*[0-9a-f]{7,40}\b|git\+|git:\/\//i.test(combined)) {
    return {
      kind: "git",
      line: resLine,
      entry: cleanKey,
      detail: `package "${cleanKey}" resolves from an unreviewed git source`,
    };
  }

  if (/\btarball:\s*\S+|https?:\/\//i.test(combined)) {
    return {
      kind: "url-tarball",
      line: resLine,
      entry: cleanKey,
      detail: `package "${cleanKey}" resolves from an unreviewed URL tarball`,
    };
  }

  if (/\bdirectory:\s*\S+|\btype:\s*directory\b|\b(?:file|link):/i.test(combined)) {
    return {
      kind: "local-path",
      line: resLine,
      entry: cleanKey,
      detail: `package "${cleanKey}" resolves from an unreviewed local-path source`,
    };
  }

  if (!INTEGRITY_RE.test(combined)) {
    return {
      kind: "missing-integrity",
      line: resLine,
      entry: cleanKey,
      detail: `package "${cleanKey}" resolution is missing a sha256/sha384/sha512 integrity digest`,
    };
  }

  return null;
}

/**
 * Parses `pnpm-lock.yaml` text and validates all workspace importer entries and
 * resolved package entries.
 */
export function validateLockfileSources(lockfileText, options = {}) {
  const allowlist = new Set(options.allowlist ?? []);
  const rawLines = String(lockfileText).split(/\r?\n/);

  const workspaceImporters = new Set();
  const importerDeps = [];
  const packageEntries = [];

  let topSection = null;
  let currentImporter = null;
  let currentDepGroup = null;
  let currentDepName = null;

  let currentPkg = null;
  let inResolutionBlock = false;

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNumber = i + 1;
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*$/.test(rawLine)) {
      topSection = rawLine.slice(0, rawLine.indexOf(":")).trim();
      currentImporter = null;
      currentDepGroup = null;
      currentDepName = null;
      currentPkg = null;
      inResolutionBlock = false;
      continue;
    }

    if (topSection === "importers") {
      const importerMatch = rawLine.match(/^ {2}([^:\s][^:]*):\s*$/);
      if (importerMatch) {
        currentImporter = stripQuotes(importerMatch[1]);
        workspaceImporters.add(currentImporter);
        currentDepGroup = null;
        currentDepName = null;
        continue;
      }

      const groupMatch = rawLine.match(/^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/);
      if (groupMatch && currentImporter) {
        currentDepGroup = groupMatch[1];
        currentDepName = null;
        continue;
      }

      const depMatch = rawLine.match(/^ {6}(.+):\s*$/);
      if (depMatch && currentImporter && currentDepGroup) {
        currentDepName = stripQuotes(depMatch[1]);
        continue;
      }

      const fieldMatch = rawLine.match(/^ {8}(specifier|version):\s*(.+?)\s*$/);
      if (fieldMatch && currentImporter && currentDepGroup && currentDepName) {
        importerDeps.push({
          importer: currentImporter,
          group: currentDepGroup,
          depName: currentDepName,
          field: fieldMatch[1],
          value: fieldMatch[2],
          line: lineNumber,
        });
      }
      continue;
    }

    if (topSection === "packages") {
      const pkgMatch = rawLine.match(/^ {2}([^:\s][^:]*):\s*$/);
      if (pkgMatch) {
        currentPkg = {
          key: stripQuotes(pkgMatch[1]),
          line: lineNumber,
          resolutionLines: [],
        };
        packageEntries.push(currentPkg);
        inResolutionBlock = false;
        continue;
      }

      if (!currentPkg) continue;

      const inlineResMatch = rawLine.match(/^ {4}resolution:\s*(.+?)\s*$/);
      if (inlineResMatch) {
        currentPkg.resolutionLines.push({ line: lineNumber, text: inlineResMatch[1] });
        inResolutionBlock = false;
        continue;
      }

      if (/^ {4}resolution:\s*$/.test(rawLine)) {
        inResolutionBlock = true;
        continue;
      }

      if (inResolutionBlock) {
        if (/^ {6}\S/.test(rawLine)) {
          currentPkg.resolutionLines.push({ line: lineNumber, text: trimmed });
          continue;
        }
        inResolutionBlock = false;
      }
    }
  }

  const violations = [];

  for (const item of importerDeps) {
    const entryId = `${item.importer}:${item.depName}`;
    if (allowlist.has(entryId) || allowlist.has(item.depName)) continue;

    const problem = classifyImporterSource(
      item.importer,
      item.field,
      item.value,
      workspaceImporters,
    );
    if (problem) {
      violations.push({
        section: "importers",
        entry: entryId,
        kind: problem.kind,
        line: item.line,
        detail: `${entryId} (${item.group}) ${problem.detail}`,
      });
    }
  }

  for (const pkg of packageEntries) {
    if (allowlist.has(pkg.key)) continue;

    const problem = classifyPackageEntry(pkg.key, pkg.resolutionLines, pkg.line);
    if (problem) {
      violations.push({
        section: "packages",
        entry: pkg.key,
        kind: problem.kind,
        line: problem.line,
        detail: problem.detail,
      });
    }
  }

  return {
    ok: violations.length === 0,
    importerCount: workspaceImporters.size,
    packageCount: packageEntries.length,
    violations,
  };
}
