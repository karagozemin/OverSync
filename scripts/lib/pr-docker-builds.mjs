/**
 * Validates that `.github/workflows/ci.yml` performs no-push Docker builds for
 * both service images (`resolver/Dockerfile` and `relayer/Dockerfile`) on pull
 * requests so broken production images are caught before release (issue #398).
 */

export const REQUIRED_SERVICE_DOCKER_BUILDS = Object.freeze([
  {
    service: "resolver",
    context: "./resolver",
    file: "./resolver/Dockerfile",
  },
  {
    service: "relayer",
    context: "./relayer",
    file: "./relayer/Dockerfile",
  },
]);

export function parseDockerBuildSteps(workflowText) {
  const source = String(workflowText ?? "");
  const stepRegex =
    /- name:\s*([^\r\n]+)\r?\n([\s\S]*?)(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/g;
  const builds = [];

  for (const match of source.matchAll(stepRegex)) {
    const [, name, body] = match;
    if (!/uses:\s*docker\/build-push-action@v\d+/.test(body)) continue;

    const contextMatch = body.match(/^\s*context:\s*(\S+)\s*$/m);
    const fileMatch = body.match(/^\s*file:\s*(\S+)\s*$/m);
    const pushMatch = body.match(/^\s*push:\s*(\S+)\s*$/m);

    builds.push({
      name: name.trim(),
      context: contextMatch ? contextMatch[1].trim() : null,
      file: fileMatch ? fileMatch[1].trim() : null,
      push: pushMatch ? pushMatch[1].trim() : null,
    });
  }

  return builds;
}

export function validatePrDockerBuilds(workflowText) {
  const violations = [];
  const builds = parseDockerBuildSteps(workflowText);

  for (const required of REQUIRED_SERVICE_DOCKER_BUILDS) {
    const match = builds.find(
      (b) => b.context === required.context && b.file === required.file,
    );
    if (!match) {
      violations.push(
        `ci.yml is missing a docker/build-push-action step for ${required.service} (context: ${required.context}, file: ${required.file})`,
      );
      continue;
    }

    if (match.push !== "false") {
      violations.push(
        `ci.yml Docker build step "${match.name}" for ${required.service} must set push: false (got "${match.push}")`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    builds,
    violations,
  };
}
