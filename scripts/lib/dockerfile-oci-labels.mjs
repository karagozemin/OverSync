/**
 * Issue #400 — OCI image label inspection.
 *
 * Verifies that the FINAL build stage of a service Dockerfile declares the
 * standard OCI annotations for repository URL, commit revision, version, and
 * licenses. Source, revision, and version must be fed by an `ARG` declared in
 * that same stage so container builds (for example `.github/workflows/release.yml`)
 * can inject the real values with `--build-arg`.
 */

/** OCI label keys whose value must come from a build argument. */
export const BUILD_ARG_LABELS = Object.freeze([
  "org.opencontainers.image.source",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.version",
]);

/** Every OCI label key the final stage must declare. */
export const REQUIRED_OCI_LABELS = Object.freeze([
  ...BUILD_ARG_LABELS,
  "org.opencontainers.image.licenses",
]);

const FROM_RE = /^FROM\s/i;
const ARG_RE = /^ARG\s+([A-Za-z_][A-Za-z0-9_]*)/i;
const LABEL_RE = /^LABEL\s+(.+)$/i;
const LABEL_PAIR_RE = /([A-Za-z0-9_.\-]+)=("(?:[^"\\]|\\.)*"|\S+)/g;
const ARG_REF_RE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Splits a Dockerfile into logical instructions, joining `\` line
 * continuations and dropping blank lines and comments.
 */
export function logicalInstructions(content) {
  const instructions = [];
  let pending = "";
  for (const rawLine of String(content ?? "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!pending && (!trimmed || trimmed.startsWith("#"))) continue;
    if (trimmed.endsWith("\\")) {
      pending += `${trimmed.slice(0, -1).trim()} `;
      continue;
    }
    instructions.push(`${pending}${trimmed}`.trim());
    pending = "";
  }
  if (pending.trim()) instructions.push(pending.trim());
  return instructions;
}

/** Parses the `key=value` pairs of a LABEL instruction body. */
export function parseLabelPairs(body) {
  const labels = new Map();
  for (const [, key, rawValue] of String(body).matchAll(LABEL_PAIR_RE)) {
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;
    labels.set(key, value);
  }
  return labels;
}

/**
 * Checks the final build stage of `content` for the required OCI labels.
 * Returns a list of error strings; empty means the check passes.
 *
 * `label` identifies the file in error messages (e.g. `relayer/Dockerfile`).
 */
export function checkDockerfileOciLabels(content, label) {
  const instructions = logicalInstructions(content);
  const lastFrom = instructions.findLastIndex((line) => FROM_RE.test(line));
  if (lastFrom === -1) {
    return [`${label}: no FROM stage found`];
  }

  const stageArgs = new Set();
  const labels = new Map();
  for (const instruction of instructions.slice(lastFrom + 1)) {
    const argMatch = instruction.match(ARG_RE);
    if (argMatch) {
      stageArgs.add(argMatch[1]);
      continue;
    }
    const labelMatch = instruction.match(LABEL_RE);
    if (labelMatch) {
      for (const [key, value] of parseLabelPairs(labelMatch[1])) {
        labels.set(key, { value, args: new Set(stageArgs) });
      }
    }
  }

  const errors = [];
  for (const key of REQUIRED_OCI_LABELS) {
    const entry = labels.get(key);
    if (!entry || !entry.value.trim()) {
      errors.push(`${label}: final build stage is missing LABEL ${key}`);
      continue;
    }
    if (!BUILD_ARG_LABELS.includes(key)) continue;

    const refs = [...entry.value.matchAll(ARG_REF_RE)].map((m) => m[1]);
    if (refs.length === 0) {
      errors.push(`${label}: LABEL ${key} must be set from a build ARG`);
    } else if (!refs.every((ref) => entry.args.has(ref))) {
      errors.push(
        `${label}: LABEL ${key} references an ARG not declared earlier in the final build stage`,
      );
    }
  }
  return errors;
}
