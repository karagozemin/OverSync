/**
 * Branch-scoped concurrency cancellation policy for the address verification
 * workflow (`.github/workflows/address-verify.yml`, issue #389).
 *
 * Ensures stale `address-verify` runs on the same branch or pull request ref
 * are automatically cancelled while allowing independent branches to verify in
 * parallel.
 */

export const CANONICAL_CONCURRENCY_GROUP = "${{ github.workflow }}-${{ github.ref }}";

const BRANCH_REF_TOKEN_RE =
  /\$\{\{\s*[^}]*\bgithub\.(?:ref|ref_name|head_ref)\b[^}]*\}\}/;

/**
 * Extracts a top-level `concurrency:` block from a workflow YAML file if present.
 */
export function extractTopLevelConcurrency(workflowText) {
  const lines = String(workflowText ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^concurrency:\s*$/.test(line));
  if (start === -1) {
    return null;
  }

  let group = null;
  let cancelInProgress = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(raw)) break;

    const groupMatch = trimmed.match(/^group:\s*(.+)$/);
    if (groupMatch) {
      group = groupMatch[1].trim().replace(/^['"]|['"]$/g, "");
      continue;
    }

    const cancelMatch = trimmed.match(/^cancel-in-progress:\s*(.+)$/);
    if (cancelMatch) {
      const val = cancelMatch[1].trim().toLowerCase();
      cancelInProgress = val === "true" ? true : val === "false" ? false : val;
    }
  }

  return { group, cancelInProgress };
}

/**
 * Builds the branch-scoped concurrency configuration for `address-verify.yml`.
 */
export function buildAddressVerifyConcurrencyConfig(workflowText) {
  const nameMatch = String(workflowText ?? "").match(/^name:\s*([^\r\n]+)/m);
  const workflowName = nameMatch ? nameMatch[1].trim() : "address-verify";
  const extracted = extractTopLevelConcurrency(workflowText);

  return {
    workflowName,
    group: extracted?.group ?? CANONICAL_CONCURRENCY_GROUP,
    cancelInProgress: extracted?.cancelInProgress ?? true,
  };
}

/**
 * Validates that an `address-verify` concurrency configuration is branch-scoped
 * and enables `cancel-in-progress: true`.
 */
export function validateAddressVerifyConcurrency(config) {
  const violations = [];

  if (!config || typeof config !== "object") {
    return {
      ok: false,
      violations: ["address-verify concurrency configuration is missing"],
    };
  }

  const group = String(config.group ?? "").trim();
  if (!group) {
    violations.push("concurrency.group must not be empty");
  } else {
    const hasWorkflowScope =
      group.includes("github.workflow") || group.includes("address-verify");
    if (!hasWorkflowScope) {
      violations.push(
        `concurrency.group "${group}" must include github.workflow or "address-verify" to avoid colliding with other workflows`,
      );
    }
    if (!BRANCH_REF_TOKEN_RE.test(group)) {
      violations.push(
        `concurrency.group "${group}" must be scoped by branch/ref (github.ref, github.ref_name, or github.head_ref)`,
      );
    }
  }

  if (config.cancelInProgress !== true) {
    violations.push(
      `concurrency.cancel-in-progress must be true so stale runs are cancelled (got "${config.cancelInProgress}")`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Resolves the concrete concurrency group key for a workflow run on a given ref.
 */
export function resolveAddressVerifyConcurrencyKey({
  workflow = "address-verify",
  ref = "refs/heads/master",
  headRef = "",
}) {
  const effectiveRef = headRef ? `refs/heads/${headRef}` : ref;
  return `${workflow}-${effectiveRef}`;
}
