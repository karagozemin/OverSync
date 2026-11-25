/**
 * Hadolint configuration validator and Dockerfile linter for `resolver/Dockerfile`
 * and `relayer/Dockerfile` (issue #397).
 *
 * Enforces a small reviewed `.hadolint.yaml` configuration and makes high-severity
 * (`error` and `warning`) findings blocking.
 */

export const TARGET_DOCKERFILES = Object.freeze([
  "resolver/Dockerfile",
  "relayer/Dockerfile",
]);

const SEVERITY_RANK = Object.freeze({
  error: 3,
  warning: 2,
  info: 1,
  style: 0,
});

const MAX_IGNORED_RULES = 5;

/**
 * Parses `.hadolint.yaml` into `{ failureThreshold, trustedRegistries, ignored }`.
 */
export function parseHadolintConfig(yamlText) {
  const lines = String(yamlText ?? "").split(/\r?\n/);
  let failureThreshold = null;
  const trustedRegistries = [];
  const ignored = [];
  let currentList = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const thresholdMatch = trimmed.match(/^failure-threshold:\s*(\S+)$/);
    if (thresholdMatch) {
      failureThreshold = thresholdMatch[1].trim().toLowerCase();
      currentList = null;
      continue;
    }

    if (/^trustedRegistries:\s*$/.test(trimmed)) {
      currentList = trustedRegistries;
      continue;
    }

    if (/^ignored:\s*$/.test(trimmed)) {
      currentList = ignored;
      continue;
    }

    const itemMatch = trimmed.match(/^-\s*(\S+)/);
    if (itemMatch && currentList) {
      currentList.push(itemMatch[1].trim());
    }
  }

  return {
    failureThreshold,
    trustedRegistries,
    ignored,
  };
}

/**
 * Validates that `.hadolint.yaml` sets a blocking `failure-threshold` (`error`
 * or `warning`) and keeps the `ignored` rule list small and reviewed.
 */
export function validateHadolintConfig(config) {
  const violations = [];

  if (!config || !config.failureThreshold) {
    violations.push(".hadolint.yaml must declare failure-threshold");
  } else if (
    config.failureThreshold !== "error" &&
    config.failureThreshold !== "warning"
  ) {
    violations.push(
      `.hadolint.yaml failure-threshold must be "error" or "warning" so high-severity findings are blocking (got "${config.failureThreshold}")`,
    );
  }

  if (!Array.isArray(config?.trustedRegistries) || config.trustedRegistries.length === 0) {
    violations.push(".hadolint.yaml must declare at least one trustedRegistries entry");
  }

  if (Array.isArray(config?.ignored) && config.ignored.length > MAX_IGNORED_RULES) {
    violations.push(
      `.hadolint.yaml ignored list has ${config.ignored.length} rules; keep reviewed ignores <= ${MAX_IGNORED_RULES}`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Lints a Dockerfile against core Hadolint high-severity (`error` and `warning`)
 * rules and applies `.hadolint.yaml` ignore/threshold filtering.
 */
export function lintDockerfile(dockerfileText, options = {}) {
  const file = options.file ?? "Dockerfile";
  const config = options.config ?? {
    failureThreshold: "warning",
    trustedRegistries: ["docker.io", "ghcr.io"],
    ignored: [],
  };
  const ignoredSet = new Set(config.ignored ?? []);
  const thresholdRank = SEVERITY_RANK[config.failureThreshold] ?? SEVERITY_RANK.warning;

  const lines = String(dockerfileText).split(/\r?\n/);
  const declaredStages = new Set();
  const findings = [];

  function addFinding(line, code, severity, message) {
    if (ignoredSet.has(code)) return;
    const rank = SEVERITY_RANK[severity] ?? 0;
    findings.push({
      file,
      line,
      code,
      severity,
      blocking: rank >= thresholdRank,
      message,
    });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const fromMatch = trimmed.match(/^FROM\s+([^\s]+)(?:\s+AS\s+([A-Za-z0-9_-]+))?$/i);
    if (fromMatch) {
      const [, imageSpec, stageName] = fromMatch;
      if (stageName) {
        declaredStages.add(stageName);
      }

      if (!declaredStages.has(imageSpec)) {
        if (!imageSpec.includes(":") && !imageSpec.includes("@sha256:")) {
          addFinding(
            lineNum,
            "DL3006",
            "warning",
            `Always tag the version of an image explicitly (${imageSpec})`,
          );
        } else if (/:latest$/i.test(imageSpec)) {
          addFinding(
            lineNum,
            "DL3007",
            "warning",
            `Using latest is prone to errors if the image will ever update (${imageSpec})`,
          );
        }
      }
      continue;
    }

    const workdirMatch = trimmed.match(/^WORKDIR\s+(.+)$/i);
    if (workdirMatch) {
      const workdirPath = workdirMatch[1].trim();
      if (!workdirPath.startsWith("/") && !workdirPath.startsWith("$")) {
        addFinding(
          lineNum,
          "DL3000",
          "error",
          `Use absolute WORKDIR (${workdirPath})`,
        );
      }
      continue;
    }

    if (/^ADD\s+/i.test(trimmed)) {
      addFinding(
        lineNum,
        "DL3020",
        "error",
        "Use COPY instead of ADD for files and folders",
      );
      continue;
    }

    const copyFromMatch = trimmed.match(/^COPY\s+--from=([^\s]+)\s+/i);
    if (copyFromMatch) {
      const fromRef = copyFromMatch[1];
      if (!declaredStages.has(fromRef) && !/^\d+$/.test(fromRef)) {
        addFinding(
          lineNum,
          "DL3022",
          "warning",
          `COPY --from should reference a previously defined FROM alias (${fromRef})`,
        );
      }
      continue;
    }

    const runMatch = trimmed.match(/^RUN\s+(.+)$/i);
    if (runMatch) {
      const cmd = runMatch[1];
      if (/\bsudo\b/.test(cmd)) {
        addFinding(
          lineNum,
          "DL3004",
          "error",
          "Do not use sudo as it leads to unpredictable behavior",
        );
      }
      continue;
    }

    const cmdOrEntryMatch = trimmed.match(/^(CMD|ENTRYPOINT)\s+(.+)$/i);
    if (cmdOrEntryMatch) {
      const [, instruction, argText] = cmdOrEntryMatch;
      if (!argText.trim().startsWith("[")) {
        addFinding(
          lineNum,
          "DL3025",
          "warning",
          `Use arguments JSON notation for ${instruction.toUpperCase()} and ENTRYPOINT arguments`,
        );
      }
    }
  }

  const blockingFindings = findings.filter((f) => f.blocking);
  return {
    ok: blockingFindings.length === 0,
    file,
    findings,
    blockingFindings,
  };
}
