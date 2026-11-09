import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Deterministic, read-only formatting check across the root and all workspace
 * manifests (issue #390).
 *
 * Ensures that `format:check` is wired in the root `package.json` and invoked
 * in `.github/workflows/ci.yml` without rewriting files (`--write` / `-w`).
 */

export function resolveWorkspaceDirs(repoRoot, rootManifest) {
  const patterns = Array.isArray(rootManifest?.workspaces)
    ? rootManifest.workspaces
    : [];

  return patterns.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    const parentPath = join(repoRoot, parent);
    if (!existsSync(parentPath)) return [];
    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

export function checkJsonFormatting(rawText, filePath) {
  const violations = [];
  const normalized = String(rawText ?? "").replace(/\r\n/g, "\n");

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    return {
      ok: false,
      violations: [`${filePath}: invalid JSON (${err.message})`],
    };
  }

  const canonical = JSON.stringify(parsed, null, 2);
  if (normalized.trim() !== canonical) {
    violations.push(
      `${filePath}: formatting does not match canonical 2-space JSON indentation`,
    );
  }

  if (/\t/.test(normalized)) {
    violations.push(`${filePath}: contains tab characters; use 2-space indentation`);
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

export function checkWorkspaceFormatting(repoRoot) {
  const violations = [];
  const rootManifestPath = join(repoRoot, "package.json");
  const rootRaw = readFileSync(rootManifestPath, "utf8");
  const rootCheck = checkJsonFormatting(rootRaw, "package.json");
  violations.push(...rootCheck.violations);

  if (!rootCheck.ok) {
    return { ok: false, checkedFiles: ["package.json"], violations };
  }

  const rootManifest = JSON.parse(rootRaw);
  const dirs = resolveWorkspaceDirs(repoRoot, rootManifest);
  const checkedFiles = ["package.json"];

  for (const dir of dirs) {
    const relPath = `${dir}/package.json`;
    const absPath = join(repoRoot, dir, "package.json");
    if (!existsSync(absPath)) continue;
    checkedFiles.push(relPath);
    const raw = readFileSync(absPath, "utf8");
    const res = checkJsonFormatting(raw, relPath);
    violations.push(...res.violations);
  }

  return {
    ok: violations.length === 0,
    checkedFiles,
    violations,
  };
}

export function validateFormatCheckConfig({ rootManifest, ciWorkflowText }) {
  const violations = [];
  const script = rootManifest?.scripts?.["format:check"];

  if (!script) {
    violations.push('root package.json is missing scripts["format:check"]');
  } else if (/--write\b|\s-w\b/.test(script)) {
    violations.push(
      `scripts["format:check"] ("${script}") must be read-only and never pass --write or -w`,
    );
  }

  const ciSource = String(ciWorkflowText ?? "");
  if (!/pnpm\s+(?:run\s+)?format:check\b|check-workspace-format\.mjs/.test(ciSource)) {
    violations.push("ci.yml must run pnpm format:check");
  }

  return {
    ok: violations.length === 0,
    script: script ?? null,
    violations,
  };
}
