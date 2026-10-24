import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Node engine consistency validator across `.nvmrc`, CI workflows, root
 * `package.json`, and workspace manifests (issue #395).
 */

const MAJOR_RE = /^v?(\d+)(?:\.\d+\.\d+)?$/;
const ENGINE_FLOOR_RE = /^>=(\d+)\.0\.0$/;

/**
 * Parses the Node major version from `.nvmrc` content, flagging stray
 * horizontal whitespace on the version line.
 */
export function parseNvmrcMajor(nvmrcText) {
  const line = String(nvmrcText).replace(/\r?\n$/, "");
  if (line !== line.trim()) {
    return {
      major: null,
      error: `.nvmrc contains leading or trailing whitespace: ${JSON.stringify(line)}`,
    };
  }
  const match = line.match(MAJOR_RE);
  if (!match) {
    return {
      major: null,
      error: `.nvmrc value "${line}" is not a valid Node version`,
    };
  }
  return { major: Number(match[1]), error: null };
}

/**
 * Extracts `node-version:` values from workflow YAML content.
 */
export function extractWorkflowNodeMajors(workflowName, workflowText) {
  const results = [];
  const lines = String(workflowText).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^\s*node-version:\s*['"]?v?(\d+)(?:\.\d+(?:\.\d+)?)?['"]?\s*$/);
    if (match) {
      results.push({
        workflow: workflowName,
        line: i + 1,
        major: Number(match[1]),
      });
    }
  }
  return results;
}

/**
 * Validates that `.nvmrc`, all CI `node-version` entries, and all workspace
 * `engines.node` ranges agree on the same Node major floor (`>=<major>.0.0`).
 */
export function validateNodeEngineConsistency({
  nvmrcText,
  workflows,
  manifests,
}) {
  const violations = [];
  const nvmrc = parseNvmrcMajor(nvmrcText);
  if (nvmrc.error) {
    violations.push(nvmrc.error);
  }

  const targetMajor = nvmrc.major;
  const expectedEngineRange = targetMajor ? `>=${targetMajor}.0.0` : null;

  for (const wf of workflows) {
    const hits = extractWorkflowNodeMajors(wf.name, wf.content);
    for (const hit of hits) {
      if (targetMajor !== null && hit.major !== targetMajor) {
        violations.push(
          `${hit.workflow}:${hit.line} uses node-version ${hit.major}, which disagrees with .nvmrc (${targetMajor})`,
        );
      }
    }
  }

  for (const manifest of manifests) {
    const actual = manifest.json?.engines?.node;
    if (!actual) {
      violations.push(
        `${manifest.path} is missing engines.node (expected "${expectedEngineRange ?? ">=22.0.0"}")`,
      );
      continue;
    }
    const floorMatch = String(actual).match(ENGINE_FLOOR_RE);
    if (!floorMatch) {
      violations.push(
        `${manifest.path} engines.node "${actual}" must use canonical floor syntax "${expectedEngineRange ?? ">=22.0.0"}"`,
      );
      continue;
    }
    if (targetMajor !== null && Number(floorMatch[1]) !== targetMajor) {
      violations.push(
        `${manifest.path} engines.node "${actual}" disagrees with .nvmrc and CI Node ${targetMajor} (expected "${expectedEngineRange}")`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    targetMajor,
    expectedEngineRange,
    violations,
  };
}

/**
 * Loads `.nvmrc`, `.github/workflows/*.yml`, root `package.json`, and all
 * workspace `package.json` manifests from `repoRoot`.
 */
export function loadRepositoryNodeMetadata(repoRoot) {
  const nvmrcText = readFileSync(join(repoRoot, ".nvmrc"), "utf8");
  const workflowsDir = join(repoRoot, ".github", "workflows");
  const workflows = readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((name) => ({
      name,
      content: readFileSync(join(workflowsDir, name), "utf8"),
    }));

  const rootRaw = readFileSync(join(repoRoot, "package.json"), "utf8");
  const rootJson = JSON.parse(rootRaw);
  const workspaceDirs = (rootJson.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });

  const manifests = [
    { path: "package.json", json: rootJson },
    ...workspaceDirs
      .filter((dir) => existsSync(join(repoRoot, dir, "package.json")))
      .map((dir) => ({
        path: `${dir}/package.json`,
        json: JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8")),
      })),
  ];

  return { nvmrcText, workflows, manifests };
}
