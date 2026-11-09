/**
 * Validates that `.github/workflows/address-verify.yml` declares a top-level
 * branch/ref-scoped `concurrency` group with `cancel-in-progress: true` so
 * superseded runs are cancelled (issue #389).
 */

export function parseTopLevelConcurrency(workflowText) {
  const lines = String(workflowText ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => line === "concurrency:");
  if (start === -1) {
    return null;
  }

  let group = null;
  let cancelInProgress = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) break;

    const groupMatch = line.match(/^\s+group:\s*(.+?)\s*$/);
    if (groupMatch) {
      group = groupMatch[1].replace(/^['"]|['"]$/g, "");
      continue;
    }

    const cancelMatch = line.match(/^\s+cancel-in-progress:\s*(\S+)\s*$/);
    if (cancelMatch) {
      cancelInProgress = cancelMatch[1];
    }
  }

  return { group, cancelInProgress };
}

export function validateAddressVerifyConcurrency(workflowText) {
  const violations = [];
  const concurrency = parseTopLevelConcurrency(workflowText);

  if (!concurrency) {
    violations.push("address-verify.yml must declare top-level concurrency");
    return { ok: false, concurrency: null, violations };
  }

  if (!concurrency.group) {
    violations.push("address-verify.yml concurrency block is missing group");
  } else if (
    !concurrency.group.includes("github.ref") &&
    !concurrency.group.includes("github.head_ref")
  ) {
    violations.push(
      `address-verify.yml concurrency group "${concurrency.group}" must be scoped by branch/ref (github.ref or github.head_ref)`,
    );
  }

  if (concurrency.cancelInProgress !== "true") {
    violations.push(
      `address-verify.yml concurrency cancel-in-progress must be true (got "${concurrency.cancelInProgress}")`,
    );
  }

  return {
    ok: violations.length === 0,
    concurrency,
    violations,
  };
}
