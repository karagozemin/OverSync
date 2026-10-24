/**
 * OCI image metadata label builder and Dockerfile label validator (issue #400).
 *
 * Ensures container builds populate standard OpenContainers (`org.opencontainers.image.*`)
 * labels for repository source URL, commit revision, semantic version, and SPDX license.
 */

export const REQUIRED_OCI_LABEL_KEYS = Object.freeze([
  "org.opencontainers.image.source",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.version",
  "org.opencontainers.image.licenses",
]);

const HTTPS_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const REVISION_RE = /^(?:[0-9a-f]{7,40}|unknown)$/i;
const VERSION_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function stripQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Normalizes a repository URL (`git+https://...` or `.../.git`) to a canonical
 * `https://github.com/<owner>/<repo>` URL suitable for `org.opencontainers.image.source`.
 */
export function normalizeRepositorySourceUrl(rawUrl) {
  const clean = stripQuotes(rawUrl)
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
  return clean;
}

/**
 * Joins backslash-continued physical lines in a Dockerfile into logical instructions.
 */
function logicalDockerfileLines(dockerfileText) {
  const rawLines = String(dockerfileText).split(/\r?\n/);
  const logical = [];
  let buffer = "";
  let startLine = 1;

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (!buffer && (!trimmed || trimmed.startsWith("#"))) {
      continue;
    }
    if (!buffer) {
      startLine = i + 1;
    }
    if (trimmed.endsWith("\\")) {
      buffer += `${trimmed.slice(0, -1).trim()} `;
    } else {
      buffer += trimmed;
      logical.push({ line: startLine, text: buffer.trim() });
      buffer = "";
    }
  }
  if (buffer) {
    logical.push({ line: startLine, text: buffer.trim() });
  }
  return logical;
}

/**
 * Extracts `ARG` defaults and `LABEL` key/value pairs from a Dockerfile.
 */
export function extractDockerfileOciMetadata(dockerfileText) {
  const instructions = logicalDockerfileLines(dockerfileText);
  const args = {};
  const rawLabels = {};
  const resolvedLabels = {};

  for (const item of instructions) {
    const argMatch = item.text.match(/^ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/i);
    if (argMatch) {
      const [, name, defaultVal] = argMatch;
      args[name] = defaultVal !== undefined ? stripQuotes(defaultVal) : "";
      continue;
    }

    const labelMatch = item.text.match(/^LABEL\s+(.+)$/i);
    if (labelMatch) {
      const body = labelMatch[1];
      const pairRe = /([A-Za-z0-9_.-]+)=("[^"]*"|'[^']*'|[^\s]+)/g;
      let match;
      while ((match = pairRe.exec(body)) !== null) {
        const key = match[1];
        const rawValue = stripQuotes(match[2]);
        rawLabels[key] = rawValue;
        resolvedLabels[key] = rawValue.replace(
          /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
          (_, varName) => args[varName] ?? `\${${varName}}`,
        );
      }
    }
  }

  return { args, rawLabels, resolvedLabels };
}

/**
 * Validates that a Dockerfile defines all required OCI labels (`source`,
 * `revision`, `version`, and `licenses`) with valid default or resolved values.
 */
export function validateDockerfileOciLabels(dockerfileText, options = {}) {
  const name = options.name ?? "Dockerfile";
  const { args, rawLabels, resolvedLabels } = extractDockerfileOciMetadata(dockerfileText);
  const violations = [];

  for (const key of REQUIRED_OCI_LABEL_KEYS) {
    if (!(key in rawLabels)) {
      violations.push(`${name}: missing required OCI label "${key}"`);
      continue;
    }
    const resolved = resolvedLabels[key];
    if (!resolved || /\$\{[^}]+\}/.test(resolved)) {
      violations.push(
        `${name}: label "${key}" references an undeclared build arg or is empty (${rawLabels[key]})`,
      );
    }
  }

  if (resolvedLabels["org.opencontainers.image.source"]) {
    const src = normalizeRepositorySourceUrl(resolvedLabels["org.opencontainers.image.source"]);
    if (!HTTPS_REPO_RE.test(src)) {
      violations.push(
        `${name}: org.opencontainers.image.source must be an https://github.com/<owner>/<repo> URL (got "${resolvedLabels["org.opencontainers.image.source"]}")`,
      );
    }
  }

  if (resolvedLabels["org.opencontainers.image.revision"]) {
    const rev = resolvedLabels["org.opencontainers.image.revision"];
    if (!REVISION_RE.test(rev)) {
      violations.push(
        `${name}: org.opencontainers.image.revision must be a hex commit SHA or "unknown" default (got "${rev}")`,
      );
    }
  }

  if (resolvedLabels["org.opencontainers.image.version"]) {
    const ver = resolvedLabels["org.opencontainers.image.version"];
    if (!VERSION_RE.test(ver)) {
      violations.push(
        `${name}: org.opencontainers.image.version must be a valid semantic version (got "${ver}")`,
      );
    }
  }

  if (resolvedLabels["org.opencontainers.image.licenses"]) {
    const lic = resolvedLabels["org.opencontainers.image.licenses"];
    if (!lic || lic.length < 2) {
      violations.push(
        `${name}: org.opencontainers.image.licenses must be a valid SPDX license expression`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    name,
    args,
    rawLabels,
    resolvedLabels,
    violations,
  };
}

/**
 * Builds validated OCI labels and `--label` / `--build-arg` CLI flags for
 * container image builds.
 */
export function buildOciImageLabels({
  source,
  revision,
  version,
  licenses = "MIT",
  title,
}) {
  const normalizedSource = normalizeRepositorySourceUrl(source);
  const cleanRevision = stripQuotes(revision);
  const cleanVersion = stripQuotes(version).replace(/^v/, "");
  const cleanLicenses = stripQuotes(licenses);

  const errors = [];
  if (!HTTPS_REPO_RE.test(normalizedSource)) {
    errors.push(`invalid OCI source URL "${source}"`);
  }
  if (!/^[0-9a-f]{7,40}$/i.test(cleanRevision)) {
    errors.push(`invalid OCI revision SHA "${revision}" (expected 7-40 hex characters)`);
  }
  if (!VERSION_RE.test(cleanVersion)) {
    errors.push(`invalid OCI version "${version}" (expected semantic version)`);
  }
  if (!cleanLicenses) {
    errors.push("OCI licenses value must not be empty");
  }

  if (errors.length > 0) {
    return { ok: false, errors, labels: {}, dockerFlags: [] };
  }

  const labels = {
    ...(title ? { "org.opencontainers.image.title": stripQuotes(title) } : {}),
    "org.opencontainers.image.source": normalizedSource,
    "org.opencontainers.image.revision": cleanRevision,
    "org.opencontainers.image.version": cleanVersion,
    "org.opencontainers.image.licenses": cleanLicenses,
  };

  const buildArgs = {
    OCI_SOURCE: normalizedSource,
    OCI_REVISION: cleanRevision,
    OCI_VERSION: cleanVersion,
    OCI_LICENSES: cleanLicenses,
  };

  const dockerFlags = [
    ...Object.entries(buildArgs).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]),
    ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]),
  ];

  return {
    ok: true,
    errors: [],
    labels,
    buildArgs,
    dockerFlags,
  };
}
