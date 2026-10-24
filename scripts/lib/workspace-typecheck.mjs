/**
 * Aggregate workspace typecheck validator (issue #393).
 *
 * Ensures the root `package.json` exposes a `typecheck` script that runs
 * `tsc --noEmit` across every maintained TypeScript workspace checked in CI
 * (`@oversync/sdk`, `@oversync/coordinator`, `@oversync/resolver`,
 * `@oversync/frontend`, and `@oversync/relayer`) in deterministic dependency
 * order (`@oversync/sdk` first).
 */

export const MAINTAINED_TS_WORKSPACES = Object.freeze([
  "@oversync/sdk",
  "@oversync/coordinator",
  "@oversync/resolver",
  "@oversync/frontend",
  "@oversync/relayer",
]);

/**
 * Extracts all `pnpm --filter <workspace> exec tsc --noEmit` (or `typecheck`)
 * targets from a root `typecheck` script command.
 */
export function parseTypecheckWorkspaces(typecheckScript) {
  if (typeof typecheckScript !== "string" || !typecheckScript.trim()) {
    return [];
  }

  const segments = typecheckScript
    .split("&&")
    .map((s) => s.trim())
    .filter(Boolean);

  const workspaces = [];
  for (const segment of segments) {
    const match = segment.match(
      /^pnpm\s+--filter\s+(@oversync\/[A-Za-z0-9_-]+)\s+(?:exec\s+tsc\s+--noEmit|typecheck)$/,
    );
    if (match) {
      workspaces.push(match[1]);
    }
  }
  return workspaces;
}

/**
 * Extracts the TypeScript workspaces that `.github/workflows/ci.yml` typechecks.
 */
export function extractCiTypecheckWorkspaces(ciWorkflowText) {
  const matches = [
    ...String(ciWorkflowText).matchAll(
      /pnpm\s+--filter\s+(@oversync\/[A-Za-z0-9_-]+)\s+exec\s+tsc\s+--noEmit/g,
    ),
  ];
  return matches.map((m) => m[1]);
}

/**
 * Validates that the root `package.json` `typecheck` script covers every
 * maintained TypeScript workspace in the same order as CI.
 */
export function validateAggregateTypecheck({ rootManifest, ciWorkflowText }) {
  const violations = [];
  const script = rootManifest?.scripts?.typecheck;

  if (!script) {
    return {
      ok: false,
      workspaces: [],
      violations: ['root package.json is missing a "typecheck" script'],
    };
  }

  const scriptWorkspaces = parseTypecheckWorkspaces(script);
  const ciWorkspaces = ciWorkflowText
    ? extractCiTypecheckWorkspaces(ciWorkflowText)
    : [...MAINTAINED_TS_WORKSPACES];

  for (const required of MAINTAINED_TS_WORKSPACES) {
    if (!scriptWorkspaces.includes(required)) {
      violations.push(
        `root "typecheck" script is missing maintained workspace "${required}"`,
      );
    }
  }

  for (const ciWs of ciWorkspaces) {
    if (!scriptWorkspaces.includes(ciWs)) {
      violations.push(
        `root "typecheck" script omits workspace "${ciWs}" that is typechecked in ci.yml`,
      );
    }
  }

  if (scriptWorkspaces[0] !== "@oversync/sdk") {
    violations.push(
      'root "typecheck" script must check "@oversync/sdk" first before downstream workspaces',
    );
  }

  return {
    ok: violations.length === 0,
    workspaces: scriptWorkspaces,
    violations,
  };
}
