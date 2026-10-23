/**
 * Issue #376 — Dockerfile runtime-user inspection.
 *
 * Parses a Dockerfile and verifies that the FINAL build stage declares a
 * non-root USER directive. Root inside earlier (builder) stages is expected
 * for `npm install` and corepack, so only the last stage must switch.
 */

const FROM_RE = /^\s*FROM\s/i;
const USER_RE = /^\s*USER\s+([^\s#]+)/i;

/**
 * Returns the line indexes of every FROM directive, i.e. the start of each
 * build stage.
 */
export function findStageStarts(content) {
  return content
    .split(/\r?\n/)
    .map((line, index) => (FROM_RE.test(line) ? index : -1))
    .filter((index) => index >= 0);
}

/**
 * Extracts the user (or user:group) spec from a USER directive
 * (`node`, `1000`, `node:node`, ...), or null when the line is no USER.
 */
export function parseUserDirective(line) {
  const match = line.match(USER_RE);
  return match ? match[1] : null;
}

/** User specs that still mean "running as root". */
function isRoot(userSpec) {
  const user = userSpec.split(":")[0].toLowerCase();
  return user === "root" || user === "0";
}

/**
 * Checks that the final build stage of `content` ends with a non-root USER
 * directive. Returns a list of error strings; empty means the check passes.
 *
 * `label` identifies the file in error messages (e.g. `relayer/Dockerfile`).
 */
export function checkDockerfileRuntimeUser(content, label) {
  const lines = content.split(/\r?\n/);
  const stageStarts = findStageStarts(content);

  if (stageStarts.length === 0) {
    return [`${label}: no FROM stage found`];
  }

  // Only inspect lines of the last stage: directives in earlier (builder)
  // stages do not affect the image's runtime user.
  const lastStage = lines.slice(stageStarts[stageStarts.length - 1]);

  const userSpecs = lastStage
    .map((line) => parseUserDirective(line))
    .filter((user) => user !== null);

  if (userSpecs.length === 0) {
    return [`${label}: final build stage declares no USER — image would run as root`];
  }

  const lastUser = userSpecs[userSpecs.length - 1];
  if (isRoot(lastUser)) {
    return [`${label}: final USER directive is root — must end on a non-root user`];
  }

  return [];
}
