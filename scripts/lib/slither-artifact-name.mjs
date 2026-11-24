/**
 * Validates that `.github/workflows/contracts.yml` names the uploaded Slither
 * report with a commit-specific short SHA (`slither-report-<short-sha>`) so
 * reruns and downloaded reports stay unambiguous (issue #388).
 */

export function formatSlitherArtifactName(commitSha) {
  const clean = String(commitSha ?? "").trim();
  if (!/^[0-9a-fA-F]{7,40}$/.test(clean)) {
    throw new Error(`Invalid commit SHA "${clean}"; expected 7..40 hex chars`);
  }
  return `slither-report-${clean.slice(0, 7).toLowerCase()}`;
}

export function validateSlitherArtifactNaming(workflowText) {
  const violations = [];
  const source = String(workflowText ?? "");

  const uploadMatch = source.match(
    /- name:\s*Upload Slither report[\s\S]*?(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!uploadMatch) {
    violations.push('contracts.yml is missing step "Upload Slither report"');
    return { ok: false, artifactName: null, violations };
  }

  const nameMatch = uploadMatch[0].match(/^\s*name:\s*(.+?)\s*$/m);
  const artifactName = nameMatch ? nameMatch[1].trim() : null;

  if (!artifactName) {
    violations.push('"Upload Slither report" is missing a with.name field');
  } else if (artifactName === "slither-report") {
    violations.push(
      '"Upload Slither report" uses static name "slither-report"; must include the short commit SHA',
    );
  } else if (
    !/^slither-report-\$\{\{\s*steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_-]+\s*\}\}$/.test(
      artifactName,
    )
  ) {
    violations.push(
      `"Upload Slither report" name "${artifactName}" must match "slither-report-\${{ steps.<id>.outputs.<short_sha> }}"`,
    );
  }

  if (!/GITHUB_SHA::7|rev-parse --short/.test(source)) {
    violations.push(
      "contracts.yml must compute a short commit SHA output before uploading the Slither report",
    );
  }

  return { ok: violations.length === 0, artifactName, violations };
}
