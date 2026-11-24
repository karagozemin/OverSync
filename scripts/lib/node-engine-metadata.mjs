/**
 * Validates that the reviewed Node toolchain is declared consistently
 * (issue #395):
 *
 * - `.nvmrc` and every `actions/setup-node` `node-version` in CI use the same
 *   Node major version.
 * - The root `package.json` `engines.node` is a `>=MAJOR.MINOR.PATCH` floor on
 *   that same major.
 * - Every workspace `package.json` declares exactly the root `engines.node`.
 */

const VERSION_RE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const ENGINE_FLOOR_RE = /^>=\s*(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parses a Node version as written in `.nvmrc` or `node-version`
 * (`22`, `22.5`, `v22.5.0`). Returns the major version, or an error.
 */
export function parseNodeVersion(raw, source) {
  const value = String(raw ?? "").trim().replace(/^['"]|['"]$/g, "");
  const match = value.match(VERSION_RE);
  if (!match) {
    return { major: null, error: `${source} Node version "${value}" must be MAJOR[.MINOR[.PATCH]]` };
  }
  return { major: Number(match[1]), error: null };
}

/**
 * Extracts every `node-version:` value from a workflow file.
 */
export function extractWorkflowNodeVersions(workflowText) {
  return [...String(workflowText ?? "").matchAll(/^\s*node-version:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

/**
 * @param {object} input
 * @param {string} input.nvmrcText - contents of `.nvmrc`
 * @param {object} input.rootManifest - parsed root `package.json`
 * @param {Record<string, object>} input.workspaceManifests - workspace path -> parsed `package.json`
 * @param {Record<string, string>} input.workflows - workflow file name -> contents
 */
export function validateNodeEngineMetadata({
  nvmrcText,
  rootManifest,
  workspaceManifests = {},
  workflows = {},
}) {
  const violations = [];

  const nvmrc = parseNodeVersion(nvmrcText, ".nvmrc");
  if (nvmrc.error) violations.push(nvmrc.error);
  const reviewedMajor = nvmrc.major;

  for (const [file, text] of Object.entries(workflows)) {
    for (const raw of extractWorkflowNodeVersions(text)) {
      const parsed = parseNodeVersion(raw, file);
      if (parsed.error) {
        violations.push(parsed.error);
      } else if (reviewedMajor !== null && parsed.major !== reviewedMajor) {
        violations.push(
          `${file} node-version "${raw}" disagrees with .nvmrc Node major ${reviewedMajor}`,
        );
      }
    }
  }

  const rootEngine = rootManifest?.engines?.node;
  if (!rootEngine) {
    violations.push("package.json is missing engines.node");
  } else {
    const floor = String(rootEngine).trim().match(ENGINE_FLOOR_RE);
    if (!floor) {
      violations.push(`package.json engines.node "${rootEngine}" must be a ">=MAJOR.MINOR.PATCH" floor`);
    } else if (reviewedMajor !== null && Number(floor[1]) !== reviewedMajor) {
      violations.push(
        `package.json engines.node "${rootEngine}" must start at .nvmrc/CI Node major ${reviewedMajor}`,
      );
    }
  }

  for (const [workspace, manifest] of Object.entries(workspaceManifests)) {
    const engine = manifest?.engines?.node;
    if (!engine) {
      violations.push(`${workspace}/package.json is missing engines.node`);
    } else if (rootEngine && engine !== rootEngine) {
      violations.push(
        `${workspace}/package.json engines.node "${engine}" must match root engines.node "${rootEngine}"`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    major: reviewedMajor,
    engine: rootEngine ?? null,
    violations,
  };
}
