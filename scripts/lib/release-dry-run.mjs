import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Release dry-run metadata validator and local build planner (issue #402).
 *
 * Parses `.github/workflows/release.yml` to extract the release image, tag
 * patterns, build context, Dockerfile, and target platforms, validates release
 * metadata, and constructs a strictly no-login, no-push `docker buildx build`
 * invocation matching the release workflow.
 */

const SEMVER_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Extracts the release build configuration from `.github/workflows/release.yml`.
 */
export function parseReleaseWorkflowConfig(workflowText) {
  const source = String(workflowText);

  const imageMatch = source.match(/images:\s*([^\r\n]+)/);
  const contextMatch = source.match(/context:\s*([^\r\n]+)/);
  const fileMatch = source.match(/file:\s*([^\r\n]+)/);
  const platformsMatch = source.match(/platforms:\s*([^\r\n]+)/);

  return {
    imageTemplate: imageMatch ? imageMatch[1].trim() : null,
    context: contextMatch ? contextMatch[1].trim() : null,
    dockerfile: fileMatch ? fileMatch[1].trim() : null,
    platforms: platformsMatch ? platformsMatch[1].trim() : null,
  };
}

/**
 * Builds a no-login, no-push release dry-run plan that mirrors
 * `.github/workflows/release.yml`.
 */
export function buildReleaseDryRunPlan({
  workflowText,
  tag,
  owner = "karagozemin",
  repoRoot,
}) {
  const cleanTag = String(tag ?? "").trim();
  const match = cleanTag.match(SEMVER_TAG_RE);
  if (!match) {
    return {
      ok: false,
      error: `Invalid release tag "${cleanTag}"; expected vMAJOR.MINOR.PATCH`,
    };
  }

  const [, major, minor, patch] = match;
  const version = `${major}.${minor}.${patch}`;
  const config = parseReleaseWorkflowConfig(workflowText);

  if (!config.imageTemplate || !config.context || !config.dockerfile || !config.platforms) {
    return {
      ok: false,
      error: "Release workflow is missing required image, context, file, or platforms fields",
    };
  }

  const image = config.imageTemplate.replace(
    "${{ github.repository_owner }}",
    owner,
  );

  if (repoRoot) {
    const contextPath = resolve(repoRoot, config.context);
    const dockerfilePath = resolve(repoRoot, config.dockerfile);
    if (!existsSync(contextPath)) {
      return {
        ok: false,
        error: `Release build context does not exist: ${config.context}`,
      };
    }
    if (!existsSync(dockerfilePath)) {
      return {
        ok: false,
        error: `Release Dockerfile does not exist: ${config.dockerfile}`,
      };
    }
  }

  const tags = [
    `${image}:${cleanTag}`,
    `${image}:${version}`,
    `${image}:${major}.${minor}`,
  ];

  const labels = [
    "org.opencontainers.image.title=oversync-resolver",
    `org.opencontainers.image.version=${version}`,
    `org.opencontainers.image.source=https://github.com/${owner}/OverSync`,
  ];

  const dockerArgs = [
    "buildx",
    "build",
    "--file",
    config.dockerfile,
    "--platform",
    config.platforms,
    ...tags.flatMap((t) => ["--tag", t]),
    ...labels.flatMap((l) => ["--label", l]),
    config.context,
  ];

  return {
    ok: true,
    mode: "dry-run",
    login: false,
    push: false,
    tag: cleanTag,
    version,
    image,
    context: config.context,
    dockerfile: config.dockerfile,
    platforms: config.platforms,
    tags,
    labels,
    dockerArgs,
  };
}

/**
 * Validates that a dry-run plan enforces the no-login, no-push invariants and
 * has complete metadata.
 */
export function validateReleaseDryRunPlan(plan) {
  const violations = [];

  if (!plan || !plan.ok) {
    violations.push(plan?.error ?? "dry-run plan is not ok");
    return { ok: false, violations };
  }

  if (plan.login !== false) {
    violations.push("dry-run mode must not log in to any container registry");
  }

  if (plan.push !== false) {
    violations.push("dry-run mode must not push container images or tags");
  }

  if (!Array.isArray(plan.tags) || plan.tags.length === 0) {
    violations.push("dry-run metadata must produce at least one image tag");
  }

  if (!Array.isArray(plan.labels) || plan.labels.length === 0) {
    violations.push("dry-run metadata must produce OCI image labels");
  }

  if (!Array.isArray(plan.dockerArgs) || plan.dockerArgs.includes("--push")) {
    violations.push("dry-run docker buildx args must not include --push");
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
