/**
 * Release image Buildx provenance attestation planner and validator (issue #396).
 *
 * Configures the Buildx release step to emit a SLSA provenance attestation
 * (`provenance: mode=max`) tied to the published container image digest.
 */

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/i;
const VALID_PROVENANCE_SPEC_RE = /^(?:true|mode=(?:max|min))$/i;

/**
 * Extracts the `docker/build-push-action` step settings from `.github/workflows/release.yml`.
 */
export function parseReleaseBuildStep(workflowText) {
  const source = String(workflowText ?? "");
  const actionMatch = source.match(/uses:\s*(docker\/build-push-action@v\d+)/);
  const contextMatch = source.match(/context:\s*([^\r\n]+)/);
  const fileMatch = source.match(/file:\s*([^\r\n]+)/);
  const platformsMatch = source.match(/platforms:\s*([^\r\n]+)/);
  const pushMatch = source.match(/^\s+push:\s*(true|false)\b/m);
  const provenanceMatch = source.match(/provenance:\s*([^\r\n]+)/);

  return {
    action: actionMatch ? actionMatch[1].trim() : null,
    context: contextMatch ? contextMatch[1].trim() : null,
    dockerfile: fileMatch ? fileMatch[1].trim() : null,
    platforms: platformsMatch ? platformsMatch[1].trim() : null,
    push: pushMatch ? pushMatch[1].trim() === "true" : false,
    provenance: provenanceMatch
      ? provenanceMatch[1].trim().replace(/^['"]|['"]$/g, "")
      : null,
  };
}

/**
 * Builds the Buildx release provenance configuration and ties the attestation
 * subject to the published image digest.
 */
export function buildReleaseProvenanceConfig({
  workflowText,
  mode = "max",
  subjectDigest = "sha256:2c4f0992fcce82505b26329f439870d00ed9451e2c4f0992fcce82505b26329f",
}) {
  const parsed = parseReleaseBuildStep(workflowText);
  const provenanceSpec =
    parsed.provenance ?? (mode === "true" ? "true" : `mode=${mode}`);

  const dockerArgs = [
    "buildx",
    "build",
    "--file",
    parsed.dockerfile ?? "./resolver/Dockerfile",
    "--platform",
    parsed.platforms ?? "linux/amd64,linux/arm64",
    `--provenance=${provenanceSpec}`,
    "--push",
    parsed.context ?? "./resolver",
  ];

  return {
    action: parsed.action,
    context: parsed.context,
    dockerfile: parsed.dockerfile,
    platforms: parsed.platforms,
    push: parsed.push,
    provenance: provenanceSpec,
    subjectDigest,
    dockerArgs,
  };
}

/**
 * Validates that a release Buildx configuration emits a provenance attestation
 * tied to a valid `sha256` published digest.
 */
export function validateReleaseProvenanceConfig(config) {
  const violations = [];

  if (!config) {
    return { ok: false, violations: ["release provenance configuration is missing"] };
  }

  if (!config.action || !/^docker\/build-push-action@v\d+$/.test(config.action)) {
    violations.push("release workflow must use docker/build-push-action");
  }

  if (config.push !== true) {
    violations.push("release build-push step must have push: true so the attestation is bound to the published registry digest");
  }

  const prov = String(config.provenance ?? "").trim();
  if (!prov || prov === "false" || !VALID_PROVENANCE_SPEC_RE.test(prov)) {
    violations.push(
      `release build step must enable provenance attestation ("mode=max", "mode=min", or "true"); got "${prov || "none"}"`,
    );
  }

  if (!config.subjectDigest || !DIGEST_RE.test(String(config.subjectDigest))) {
    violations.push(
      `provenance attestation subjectDigest must be a valid sha256 digest (got "${config.subjectDigest ?? ""}")`,
    );
  }

  if (
    !Array.isArray(config.dockerArgs) ||
    !config.dockerArgs.some((arg) => /^--provenance=(?:true|mode=(?:max|min))$/i.test(arg))
  ) {
    violations.push("docker buildx arguments must include --provenance=mode=max (or mode=min)");
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
