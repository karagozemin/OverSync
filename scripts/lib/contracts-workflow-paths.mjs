/**
 * Validates that `.github/workflows/contracts.yml` triggers on changes to the
 * root lockfile (`pnpm-lock.yaml`) and root package manifest (`package.json`)
 * in addition to `contracts/**` and the workflow file itself (issue #387).
 */

export const REQUIRED_CONTRACT_WORKFLOW_PATHS = Object.freeze([
  "contracts/**",
  "package.json",
  "pnpm-lock.yaml",
  ".github/workflows/contracts.yml",
]);

function extractTriggerPaths(workflowText, eventName) {
  const lines = String(workflowText ?? "").split(/\r?\n/);
  const onIdx = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (onIdx === -1) return [];

  let inEvent = false;
  let inPaths = false;
  const paths = [];

  for (let i = onIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      break;
    }

    const eventMatch = line.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/);
    if (eventMatch) {
      inEvent = eventMatch[1] === eventName;
      inPaths = false;
      continue;
    }

    if (!inEvent) continue;

    if (/^\s{4}paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }

    if (/^\s{4}[A-Za-z0-9_-]+:/.test(line)) {
      inPaths = false;
      continue;
    }

    if (inPaths) {
      const itemMatch = line.match(/^\s{6}-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (itemMatch) {
        paths.push(itemMatch[1].trim());
      }
    }
  }

  return paths;
}

export function validateContractWorkflowPaths(workflowText) {
  const violations = [];
  const pushPaths = extractTriggerPaths(workflowText, "push");
  const prPaths = extractTriggerPaths(workflowText, "pull_request");

  for (const requiredPath of REQUIRED_CONTRACT_WORKFLOW_PATHS) {
    if (!pushPaths.includes(requiredPath)) {
      violations.push(
        `contracts.yml push.paths is missing required path "${requiredPath}"`,
      );
    }
    if (!prPaths.includes(requiredPath)) {
      violations.push(
        `contracts.yml pull_request.paths is missing required path "${requiredPath}"`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    pushPaths,
    prPaths,
    violations,
  };
}
