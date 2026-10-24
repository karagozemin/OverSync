import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pull-request service container build planner and validator (issue #398).
 *
 * Ensures both `resolver` and `relayer` production Docker images are verified
 * and built with `push: false` (no registry push) on pull requests so broken
 * container builds are caught before release.
 */

export const REQUIRED_PR_SERVICES = Object.freeze(["resolver", "relayer"]);

export const SERVICE_IMAGE_SPECS = Object.freeze({
  resolver: {
    service: "resolver",
    context: "./resolver",
    dockerfile: "./resolver/Dockerfile",
    imageName: "oversync-resolver",
    platform: "linux/amd64",
  },
  relayer: {
    service: "relayer",
    context: "./relayer",
    dockerfile: "./relayer/Dockerfile",
    imageName: "oversync-relayer",
    platform: "linux/amd64",
  },
});

/**
 * Extracts build stages (`FROM ... AS <stage>`) and host `COPY` source paths
 * (excluding `COPY --from=...` stage copies) from a Dockerfile.
 */
export function inspectServiceDockerfile(dockerfileText) {
  const lines = String(dockerfileText).split(/\r?\n/);
  const stages = [];
  const hostCopies = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const fromMatch = trimmed.match(/^FROM\s+(\S+)(?:\s+AS\s+([A-Za-z0-9_-]+))?/i);
    if (fromMatch && fromMatch[2]) {
      stages.push(fromMatch[2]);
      continue;
    }

    const copyMatch = trimmed.match(/^COPY\s+(.+)$/i);
    if (copyMatch) {
      const tokens = copyMatch[1].trim().split(/\s+/);
      if (tokens.some((tok) => tok.startsWith("--from="))) {
        continue;
      }
      const pathTokens = tokens.filter((tok) => !tok.startsWith("--"));
      if (pathTokens.length >= 2) {
        const sources = pathTokens.slice(0, -1);
        hostCopies.push(...sources);
      }
    }
  }

  return { stages, hostCopies };
}

/**
 * Builds a no-push PR container build plan for both `resolver` and `relayer`.
 */
export function buildPrServiceImagePlan({
  repoRoot,
  services = REQUIRED_PR_SERVICES,
  tagSuffix = "pr-check",
}) {
  const builds = [];
  const errors = [];

  for (const serviceName of services) {
    const spec = SERVICE_IMAGE_SPECS[serviceName];
    if (!spec) {
      errors.push(`unknown service "${serviceName}"`);
      continue;
    }

    const contextPath = repoRoot ? resolve(repoRoot, spec.context) : null;
    const dockerfilePath = repoRoot ? resolve(repoRoot, spec.dockerfile) : null;

    let stages = [];
    let hostCopies = [];

    if (repoRoot) {
      if (!existsSync(contextPath)) {
        errors.push(`${serviceName}: build context does not exist (${spec.context})`);
      }
      if (!existsSync(dockerfilePath)) {
        errors.push(`${serviceName}: Dockerfile does not exist (${spec.dockerfile})`);
      } else {
        const parsed = inspectServiceDockerfile(readFileSync(dockerfilePath, "utf8"));
        stages = parsed.stages;
        hostCopies = parsed.hostCopies;

        for (const copySrc of hostCopies) {
          const absCopySrc = resolve(contextPath, copySrc);
          if (!existsSync(absCopySrc)) {
            errors.push(
              `${serviceName}: Dockerfile COPY source "${copySrc}" is missing in ${spec.context}`,
            );
          }
        }
      }
    }

    const tag = `${spec.imageName}:${tagSuffix}`;
    const dockerArgs = [
      "buildx",
      "build",
      "--file",
      spec.dockerfile,
      "--platform",
      spec.platform,
      "--load",
      "--tag",
      tag,
      spec.context,
    ];

    builds.push({
      service: spec.service,
      context: spec.context,
      dockerfile: spec.dockerfile,
      platform: spec.platform,
      tag,
      push: false,
      load: true,
      stages,
      hostCopies,
      dockerArgs,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    builds,
  };
}

/**
 * Validates that a PR service image build plan includes both `resolver` and
 * `relayer`, enforces `push: false` (no `--push` flag), and verifies multi-stage
 * `builder` and `runtime` stages.
 */
export function validatePrServiceImagePlan(plan) {
  const violations = [];

  if (!plan || !plan.ok) {
    violations.push(...(plan?.errors ?? ["PR service image plan is invalid"]));
  }

  const builds = Array.isArray(plan?.builds) ? plan.builds : [];
  const presentServices = new Set(builds.map((b) => b.service));

  for (const requiredService of REQUIRED_PR_SERVICES) {
    if (!presentServices.has(requiredService)) {
      violations.push(
        `PR image build plan is missing required service "${requiredService}" (both resolver and relayer must be built)`,
      );
    }
  }

  for (const item of builds) {
    if (item.push !== false) {
      violations.push(`${item.service}: PR image build must set push: false`);
    }
    if (!Array.isArray(item.dockerArgs) || item.dockerArgs.includes("--push")) {
      violations.push(`${item.service}: PR image build args must not include --push`);
    }
    if (
      Array.isArray(item.stages) &&
      item.stages.length > 0 &&
      (!item.stages.includes("builder") || !item.stages.includes("runtime"))
    ) {
      violations.push(
        `${item.service}: Dockerfile must define both "builder" and "runtime" stages`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
