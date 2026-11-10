/**
 * Validates SBOM generation and bounded retention upload in
 * `.github/workflows/release.yml` (issue #374).
 */

const VALID_SBOM_FORMATS = new Set([
  "cyclonedx-json",
  "cyclonedx-xml",
  "spdx-json",
  "spdx-tag-value",
]);

export function verifyReleaseSbomConfig(workflowText) {
  const source = String(workflowText);
  const violations = [];

  if (!/uses:\s*anchore\/sbom-action@/.test(source)) {
    violations.push("release.yml must include anchore/sbom-action to generate the resolver image SBOM");
  }

  const formatMatch = source.match(/format:\s*([^\r\n]+)/);
  const format = formatMatch ? formatMatch[1].trim() : null;
  if (!format || !VALID_SBOM_FORMATS.has(format)) {
    violations.push(
      `release.yml SBOM format must be a supported CycloneDX or SPDX format; got "${format ?? "missing"}"`,
    );
  }

  const outputMatch = source.match(/output-file:\s*([^\r\n]+)/);
  const outputFile = outputMatch ? outputMatch[1].trim() : null;
  if (!outputFile) {
    violations.push("release.yml SBOM step must specify output-file");
  }

  if (!/uses:\s*actions\/upload-artifact@/.test(source)) {
    violations.push("release.yml must upload the generated SBOM with actions/upload-artifact");
  }

  const retentionMatch = source.match(/retention-days:\s*(\S+)/);
  const retentionDays = retentionMatch ? Number(retentionMatch[1]) : NaN;
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 30
  ) {
    violations.push(
      `release.yml SBOM upload must declare a short retention-days between 1 and 30; got "${retentionMatch ? retentionMatch[1] : "missing"}"`,
    );
  }

  return {
    ok: violations.length === 0,
    format,
    outputFile,
    retentionDays: Number.isInteger(retentionDays) ? retentionDays : null,
    violations,
  };
}
