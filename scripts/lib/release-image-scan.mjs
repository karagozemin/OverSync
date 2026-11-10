/**
 * Validates that `.github/workflows/release.yml` performs a blocking
 * HIGH/CRITICAL vulnerability scan on the locally built resolver image
 * before `docker/build-push-action` pushes to GHCR (issue #373).
 */

export function verifyReleaseImageScanGate(workflowText) {
  const source = String(workflowText);
  const violations = [];

  const localBuildIndex = source.indexOf(
    "docker buildx build --load --file ./resolver/Dockerfile --tag oversync-resolver:scan ./resolver",
  );
  const trivyIndex = source.indexOf("aquasecurity/trivy-action@");
  const pushIndex = source.indexOf("docker/build-push-action@");

  if (localBuildIndex === -1) {
    violations.push(
      "release.yml must build and load the local resolver image (oversync-resolver:scan) before scanning",
    );
  }
  if (trivyIndex === -1) {
    violations.push(
      "release.yml must include aquasecurity/trivy-action to scan the resolver image",
    );
  }
  if (pushIndex === -1) {
    violations.push("release.yml is missing docker/build-push-action");
  }

  if (localBuildIndex !== -1 && trivyIndex !== -1 && localBuildIndex > trivyIndex) {
    violations.push("local resolver image build must precede Trivy vulnerability scan");
  }
  if (trivyIndex !== -1 && pushIndex !== -1 && trivyIndex > pushIndex) {
    violations.push(
      "Trivy vulnerability scan must run before docker/build-push-action pushes the image",
    );
  }

  if (!/exit-code:\s*['"]?1['"]?/.test(source)) {
    violations.push(
      "Trivy scan in release.yml must set exit-code: '1' so HIGH/CRITICAL findings block publication",
    );
  }

  const severityMatch = source.match(/severity:\s*([^\r\n]+)/);
  const severity = severityMatch ? severityMatch[1].trim() : "";
  if (!severity.includes("HIGH") || !severity.includes("CRITICAL")) {
    violations.push(
      `Trivy scan in release.yml must check both HIGH and CRITICAL severities; got "${severity || "missing"}"`,
    );
  }

  return {
    ok: violations.length === 0,
    severity: severity || null,
    violations,
  };
}
