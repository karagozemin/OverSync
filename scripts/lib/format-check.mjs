import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Deterministic, read-only formatting check across workspaces (issue #390).
 *
 * Inspects root `package.json` and every workspace `package.json` without
 * modifying any file on disk, flagging UTF-8 BOMs, tab indentation, or
 * non-canonical 2-space JSON formatting, and ensures `format:check` never
 * invokes mutating flags (`--write`, `-w`, `--fix`).
 */

const MUTATING_FLAG_RE = /(?:^|\s)(?:--write|-w|--fix)(?:\s|$)/;

function expandWorkspaceDirs(repoRoot, rootManifest) {
  return (rootManifest.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });
}

/**
 * Validates that a `format:check` script command is present and strictly
 * read-only (never passing `--write`, `-w`, or `--fix`).
 */
export function validateFormatCheckScript(scriptCommand) {
  const cmd = String(scriptCommand ?? "").trim();
  if (!cmd) {
    return {
      ok: false,
      error: 'root package.json is missing a "format:check" script',
    };
  }
  if (MUTATING_FLAG_RE.test(cmd)) {
    return {
      ok: false,
      error: `"format:check" script "${cmd}" must not use mutating flags (--write, -w, --fix)`,
    };
  }
  return { ok: true, error: null };
}

/**
 * Checks a JSON manifest's formatting in memory without writing to disk.
 */
export function checkJsonFormatting(relPath, rawText) {
  const violations = [];
  const text = String(rawText);

  if (text.startsWith("\uFEFF")) {
    violations.push(`${relPath}: contains a leading UTF-8 BOM`);
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\t+/.test(lines[i])) {
      violations.push(`${relPath}:${i + 1}: uses tab indentation instead of 2 spaces`);
      break;
    }
    if (/[ \t]+$/.test(lines[i])) {
      violations.push(`${relPath}:${i + 1}: contains trailing whitespace`);
      break;
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(normalized.replace(/^\uFEFF/, ""));
  } catch (err) {
    violations.push(`${relPath}: invalid JSON (${err.message})`);
    return violations;
  }

  const expected = JSON.stringify(parsed, null, 2);
  if (normalized.trim() !== expected) {
    violations.push(`${relPath}: JSON indentation/formatting does not match canonical 2-space layout`);
  }

  return violations;
}

/**
 * Runs the read-only formatting check across the root and all workspace
 * manifests in `repoRoot`.
 */
export function checkWorkspaceFormatting(repoRoot) {
  const rootPath = join(repoRoot, "package.json");
  const rootRaw = readFileSync(rootPath, "utf8");
  const rootJson = JSON.parse(rootRaw);

  const scriptCheck = validateFormatCheckScript(rootJson?.scripts?.["format:check"]);
  const violations = [];
  if (!scriptCheck.ok) {
    violations.push(scriptCheck.error);
  }

  const dirs = expandWorkspaceDirs(repoRoot, rootJson);
  const targets = [
    { relPath: "package.json", fullPath: rootPath },
    ...dirs
      .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
      .map((dir) => ({
        relPath: `${dir}/package.json`,
        fullPath: join(repoRoot, dir, "package.json"),
      })),
  ];

  for (const target of targets) {
    const raw = readFileSync(target.fullPath, "utf8");
    violations.push(...checkJsonFormatting(target.relPath, raw));
  }

  return {
    ok: violations.length === 0,
    readOnly: true,
    checkedFiles: targets.map((t) => t.relPath),
    violations,
  };
}
