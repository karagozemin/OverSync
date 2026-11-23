/**
 * Validates that every workspace `engines.node` range is compatible with the
 * Node version used by CI (issue #395).
 *
 * CI pins the toolchain with `actions/setup-node` `node-version`. Every
 * published and workspace manifest must declare an `engines.node` whose lower
 * bound is at least CI's major version, so a package can never declare a range
 * that CI cannot satisfy or that silently drifts below the reviewed toolchain.
 */

const NODE_VERSION_RE = /node-version:\s*['"]?(\d+)(?:\.\d+)*['"]?/;

/**
 * Extracts the CI Node major version from a workflow file's text.
 *
 * Returns `null` when no `setup-node` `node-version` is found.
 */
export function parseCiNodeMajor(workflowText) {
  const match = String(workflowText ?? "").match(NODE_VERSION_RE);
  return match ? Number(match[1]) : null;
}

/**
 * Extracts the major version from an `engines.node` range.
 *
 * Supports exact versions (`22.0.0`) and lower-bound ranges (`>=22.0.0`,
 * `>=22 <24`). Returns `null` for ranges without a usable numeric lower bound.
 */
export function parseNodeLowerMajor(enginesNode) {
  const raw = String(enginesNode ?? "").trim();
  if (!raw) return null;
  const lower = raw.match(/>=\s*(\d+)/) ?? raw.match(/^(\d+)/);
  return lower ? Number(lower[1]) : null;
}

/**
 * Validates the Node engine metadata across all workspace manifests against
 * the CI toolchain.
 *
 * @param {{path: string, enginesNode?: string|null}[]} workspaces
 * @param {string|null} ciWorkflowText
 */
export function validateNodeEngineMetadata({ workspaces, ciWorkflowText = null }) {
  const violations = [];
  const ciMajor = parseCiNodeMajor(ciWorkflowText);

  if (ciMajor === null) {
    violations.push('CI workflow does not declare a setup-node node-version');
  }

  for (const ws of workspaces) {
    const lower = parseNodeLowerMajor(ws.enginesNode);
    if (lower === null) {
      violations.push(`${ws.path} is missing engines.node`);
      continue;
    }
    if (ciMajor !== null && lower < ciMajor) {
      violations.push(
        `${ws.path} engines.node "${ws.enginesNode}" lower bound (${lower}) is below CI node-version (${ciMajor})`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    ciNodeMajor: ciMajor,
    violations,
  };
}
