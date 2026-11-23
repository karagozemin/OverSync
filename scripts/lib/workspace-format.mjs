/**
 * Deterministic, read-only formatting check for workspace manifests
 * (issue #390). Compares each package.json with canonical 2-space JSON and
 * never rewrites files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function resolveWorkspaceDirs(repoRoot, rootManifest) {
  const patterns = Array.isArray(rootManifest?.workspaces) ? rootManifest.workspaces : [];

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

export function canonicalJson(rawText) {
  const normalized = String(rawText ?? "").replace(/\r\n/g, "\n");
  const parsed = JSON.parse(normalized);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function checkJsonFormatting(rawText, filePath) {
  const violations = [];
  const normalized = String(rawText ?? "").replace(/\r\n/g, "\n");

  if (normalized.charCodeAt(0) === 0xfeff) {
    violations.push(`${filePath}: starts with a UTF-8 BOM`);
  }

  if (/\t/.test(normalized)) {
    violations.push(`${filePath}: contains tab characters; use 2-space indentation`);
  }

  let canonical;
  try {
    canonical = canonicalJson(normalized);
  } catch (err) {
    return {
      ok: false,
      violations: [`${filePath}: invalid JSON (${err.message})`],
    };
  }

  if (normalized !== canonical) {
    violations.push(`${filePath}: formatting does not match canonical 2-space JSON`);
  }

  return { ok: violations.length === 0, violations };
}

export function checkWorkspaceFormatting(repoRoot) {
  const violations = [];
  const checkedFiles = ["package.json"];
  const rootRaw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const rootCheck = checkJsonFormatting(rootRaw, "package.json");
  violations.push(...rootCheck.violations);

  if (!rootCheck.ok && rootCheck.violations.some((item) => item.includes("invalid JSON"))) {
    return { ok: false, checkedFiles, violations };
  }

  const rootManifest = JSON.parse(rootRaw);
  for (const dir of resolveWorkspaceDirs(repoRoot, rootManifest)) {
    const relPath = `${dir}/package.json`;
    const absPath = join(repoRoot, dir, "package.json");
    if (!existsSync(absPath)) continue;
    checkedFiles.push(relPath);
    violations.push(...checkJsonFormatting(readFileSync(absPath, "utf8"), relPath).violations);
  }

  return { ok: violations.length === 0, checkedFiles, violations };
}

export function validateFormatCheckConfig({ rootManifest, ciWorkflowText }) {
  const violations = [];
  const script = rootManifest?.scripts?.["format:check"];

  if (!script) {
    violations.push('root package.json is missing scripts["format:check"]');
  } else if (/--write\b|\s-w\b|--fix\b/.test(script)) {
    violations.push(
      `scripts["format:check"] ("${script}") must be read-only and never pass --write, -w, or --fix`,
    );
  }

  const ciSource = String(ciWorkflowText ?? "");
  if (!/pnpm\s+(?:run\s+)?format:check\b|check-workspace-format\.mjs/.test(ciSource)) {
    violations.push("ci.yml must run pnpm format:check");
  }
  if (/pnpm\s+(?:run\s+)?format:check[^\n]*--write|format:check[^\n]*\s-w\b/.test(ciSource)) {
    violations.push("ci.yml format:check step must not rewrite files");
  }

  return { ok: violations.length === 0, script: script ?? null, violations };
}
