/**
 * Commit-specific Slither artifact naming helper and validator (issue #388).
 *
 * Ensures Slither static analysis report artifacts include the short commit SHA
 * (`slither-report-<short-sha>`) so downloaded reports and workflow reruns are
 * never ambiguous.
 */

export const DEFAULT_SHORT_SHA_LENGTH = 7;
const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;
const COMMIT_SPECIFIC_ARTIFACT_RE = /^slither-report-([0-9a-f]{7,12})$/;

/**
 * Formats a commit-specific Slither artifact name (`slither-report-<shortSha>`)
 * from a full or short hexadecimal commit SHA.
 */
export function formatSlitherArtifactName(commitSha, options = {}) {
  const shortLength = options.shortLength ?? DEFAULT_SHORT_SHA_LENGTH;
  const raw = String(commitSha ?? "").trim();

  if (!COMMIT_SHA_RE.test(raw)) {
    throw new Error(
      `Invalid commit SHA "${raw}" for Slither artifact name (expected 7–40 hex characters)`,
    );
  }
  if (!Number.isInteger(shortLength) || shortLength < 7 || shortLength > 12) {
    throw new Error(
      `shortLength must be an integer between 7 and 12 (got ${shortLength})`,
    );
  }

  const shortSha = raw.slice(0, shortLength).toLowerCase();
  return `slither-report-${shortSha}`;
}

/**
 * Extracts the Slither upload-artifact step configuration from
 * `.github/workflows/contracts.yml`.
 */
export function extractSlitherUploadStep(workflowText) {
  const source = String(workflowText ?? "");
  const stepMatch = source.match(
    /- name:\s*Upload Slither report[\s\S]*?(?=\n {6}- |\n {2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!stepMatch) {
    return null;
  }

  const block = stepMatch[0];
  const usesMatch = block.match(/uses:\s*([^\r\n]+)/);
  const nameMatch = block.match(/name:\s*(slither-report[^\r\n]*)/);
  const pathMatch = block.match(/path:\s*([^\r\n]+)/);

  return {
    uses: usesMatch ? usesMatch[1].trim() : null,
    configuredName: nameMatch ? nameMatch[1].trim() : null,
    path: pathMatch ? pathMatch[1].trim() : null,
  };
}

/**
 * Builds the commit-specific Slither artifact configuration for a workflow run.
 */
export function buildSlitherArtifactConfig({
  workflowText,
  commitSha = "2c4f0992fcce82505b26329f439870d00ed9451e",
  shortLength = DEFAULT_SHORT_SHA_LENGTH,
}) {
  const step = extractSlitherUploadStep(workflowText);
  if (!step) {
    return {
      ok: false,
      error: "contracts.yml is missing the Upload Slither report step",
    };
  }

  let artifactName;
  try {
    artifactName = formatSlitherArtifactName(commitSha, { shortLength });
  } catch (err) {
    return {
      ok: false,
      error: err.message,
    };
  }

  return {
    ok: true,
    uses: step.uses,
    path: step.path,
    commitSha: String(commitSha).trim().toLowerCase(),
    shortSha: String(commitSha).trim().slice(0, shortLength).toLowerCase(),
    artifactName,
  };
}

/**
 * Validates that a Slither artifact name includes a lowercase 7–12 character
 * commit SHA suffix (`slither-report-<short-sha>`).
 */
export function validateSlitherArtifactName(artifactName) {
  const clean = String(artifactName ?? "").trim();
  if (!clean) {
    return { ok: false, reason: "Slither artifact name is empty" };
  }
  if (clean === "slither-report") {
    return {
      ok: false,
      reason:
        'Slither artifact name "slither-report" is missing a short commit SHA suffix (expected slither-report-<short-sha>)',
    };
  }
  const match = clean.match(COMMIT_SPECIFIC_ARTIFACT_RE);
  if (!match) {
    return {
      ok: false,
      reason: `Slither artifact name "${clean}" must match slither-report-<7..12 lowercase hex sha>`,
    };
  }
  return {
    ok: true,
    artifactName: clean,
    shortSha: match[1],
  };
}
