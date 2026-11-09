/**
 * Validates that container builds populate standard OCI image labels for
 * source repository URL, commit revision, version, and licenses
 * (`org.opencontainers.image.source`, `org.opencontainers.image.revision`,
 * `org.opencontainers.image.version`, `org.opencontainers.image.licenses`)
 * in `.github/workflows/release.yml` and both service Dockerfiles (issue #400).
 */

export const REQUIRED_OCI_LABEL_KEYS = Object.freeze([
  "org.opencontainers.image.source",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.version",
  "org.opencontainers.image.licenses",
]);

export function extractLabelKeys(text) {
  const source = String(text ?? "");
  const found = new Set();

  for (const key of REQUIRED_OCI_LABEL_KEYS) {
    const escaped = key.replace(/\./g, "\\.");
    if (new RegExp(`${escaped}\\s*=`).test(source)) {
      found.add(key);
    }
  }

  return [...found];
}

export function validateOciImageLabels({
  releaseWorkflowText,
  dockerfiles = [],
}) {
  const violations = [];
  const workflowKeys = extractLabelKeys(releaseWorkflowText);

  for (const key of REQUIRED_OCI_LABEL_KEYS) {
    if (!workflowKeys.includes(key)) {
      violations.push(`release.yml is missing OCI label "${key}"`);
    }
  }

  if (
    !/labels:\s*\$\{\{\s*steps\.meta\.outputs\.labels\s*\}\}/.test(
      String(releaseWorkflowText ?? ""),
    )
  ) {
    violations.push(
      'release.yml "Build + push" must pass labels: ${{ steps.meta.outputs.labels }}',
    );
  }

  for (const df of dockerfiles) {
    const dfKeys = extractLabelKeys(df.content);
    for (const key of REQUIRED_OCI_LABEL_KEYS) {
      if (!dfKeys.includes(key)) {
        violations.push(`${df.path} is missing OCI label "${key}"`);
      }
    }
  }

  return {
    ok: violations.length === 0,
    workflowKeys,
    violations,
  };
}
