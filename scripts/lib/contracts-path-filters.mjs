/**
 * Contract workflow path filter builder, matcher, and validator (issue #387).
 *
 * Ensures contract checks (`.github/workflows/contracts.yml` Foundry and Slither
 * jobs) trigger when the root lockfile (`pnpm-lock.yaml`) or root workspace
 * manifests (`package.json`, `pnpm-workspace.yaml`) change, not only when files
 * under `contracts/**` change.
 */

export const REQUIRED_CONTRACT_TRIGGER_PATHS = Object.freeze([
  "contracts/**",
  "pnpm-lock.yaml",
  "package.json",
  "pnpm-workspace.yaml",
  ".github/workflows/contracts.yml",
]);

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
 * Extracts `on.push.paths` and `on.pull_request.paths` from a workflow YAML text.
 */
export function extractWorkflowTriggerPaths(workflowText) {
  const lines = String(workflowText ?? "").split(/\r?\n/);
  const pushPaths = [];
  const pullRequestPaths = [];

  let inOnBlock = false;
  let currentEvent = null;
  let inPathsList = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (/^[A-Za-z0-9_-]+:\s*$/.test(rawLine)) {
      const topKey = rawLine.slice(0, rawLine.indexOf(":")).trim();
      inOnBlock = topKey === "on";
      currentEvent = null;
      inPathsList = false;
      continue;
    }

    if (!inOnBlock) continue;

    const eventMatch = rawLine.match(/^ {2}(push|pull_request):\s*$/);
    if (eventMatch) {
      currentEvent = eventMatch[1];
      inPathsList = false;
      continue;
    }

    if (/^ {4}paths:\s*$/.test(rawLine) && currentEvent) {
      inPathsList = true;
      continue;
    }

    if (inPathsList && /^ {6}-\s*(.+)$/.test(rawLine)) {
      const item = stripQuotes(rawLine.replace(/^ {6}-\s*/, ""));
      if (currentEvent === "push") {
        pushPaths.push(item);
      } else if (currentEvent === "pull_request") {
        pullRequestPaths.push(item);
      }
      continue;
    }

    if (/^ {2,4}[A-Za-z0-9_-]+:/.test(rawLine)) {
      inPathsList = false;
    }
  }

  return { pushPaths, pullRequestPaths };
}

/**
 * Builds the canonical contract workflow path filter set including root lockfile
 * and workspace manifest triggers.
 */
export function buildContractsTriggerPaths(workflowText) {
  const extracted = extractWorkflowTriggerPaths(workflowText);
  const pushSet = new Set([...extracted.pushPaths, ...REQUIRED_CONTRACT_TRIGGER_PATHS]);
  const prSet = new Set([
    ...extracted.pullRequestPaths,
    ...REQUIRED_CONTRACT_TRIGGER_PATHS,
  ]);

  return {
    pushPaths: [...pushSet],
    pullRequestPaths: [...prSet],
  };
}

/**
 * Validates that both `push` and `pull_request` path filters cover `contracts/**`,
 * `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, and
 * `.github/workflows/contracts.yml`.
 */
export function validateContractsPathFilterPolicy({
  pushPaths = [],
  pullRequestPaths = [],
}) {
  const violations = [];
  const pushSet = new Set(pushPaths);
  const prSet = new Set(pullRequestPaths);

  for (const requiredPath of REQUIRED_CONTRACT_TRIGGER_PATHS) {
    if (!pushSet.has(requiredPath)) {
      violations.push(`push.paths is missing required trigger path "${requiredPath}"`);
    }
    if (!prSet.has(requiredPath)) {
      violations.push(
        `pull_request.paths is missing required trigger path "${requiredPath}"`,
      );
    }
  }

  if (
    pushPaths.length !== pullRequestPaths.length ||
    pushPaths.some((p) => !prSet.has(p))
  ) {
    violations.push("push.paths and pull_request.paths must contain the same trigger globs");
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

function matchesTriggerPattern(filePath, pattern) {
  const cleanFile = String(filePath).replace(/\\/g, "/").replace(/^\/+/, "");
  const cleanPattern = String(pattern).replace(/\\/g, "/").replace(/^\/+/, "");

  if (cleanPattern.endsWith("/**")) {
    const prefix = cleanPattern.slice(0, -3);
    return cleanFile === prefix || cleanFile.startsWith(`${prefix}/`);
  }
  return cleanFile === cleanPattern;
}

/**
 * Evaluates whether a list of changed file paths triggers the contract workflow.
 */
export function shouldTriggerContractChecks(
  changedFiles,
  triggerPaths = REQUIRED_CONTRACT_TRIGGER_PATHS,
) {
  const matchedFiles = [];
  for (const file of changedFiles) {
    if (triggerPaths.some((pattern) => matchesTriggerPattern(file, pattern))) {
      matchedFiles.push(file);
    }
  }
  return {
    triggered: matchedFiles.length > 0,
    matchedFiles,
  };
}
