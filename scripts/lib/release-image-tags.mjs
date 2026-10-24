/**
 * Release container tag policy validator and tag builder (issue #403).
 *
 * Ensures `.github/workflows/release.yml` retains immutable version tags
 * (`type=ref,event=tag` and `type=semver,pattern={{version}}`) and never
 * publishes an un-gated mutable major-only tag (`pattern={{major}}` or
 * `pattern=v{{major}}`).
 */

const MAJOR_ONLY_PATTERN_RE = /(?:^|,)pattern=v?\{\{major\}\}(?:,|$)/i;
const EXPLICIT_INPUT_GATE_RE = /(?:^|,)enable=\$\{\{\s*inputs\.[A-Za-z0-9_-]+/;

/**
 * Extracts the `tags:` lines configured on `docker/metadata-action` in a
 * workflow YAML file.
 */
export function extractMetadataTagRules(workflowText) {
  const lines = String(workflowText).split(/\r?\n/);
  const rules = [];
  let inTagsBlock = false;
  let tagsIndent = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!inTagsBlock) {
      const match = raw.match(/^(\s*)tags:\s*\|\s*$/);
      if (match) {
        inTagsBlock = true;
        tagsIndent = match[1].length;
      }
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const currentIndent = raw.match(/^(\s*)/)[1].length;
    if (currentIndent <= tagsIndent) {
      break;
    }

    rules.push({ line: i + 1, rule: trimmed });
  }

  return rules;
}

/**
 * Checks whether a single `docker/metadata-action` tag rule publishes a
 * mutable major-only container tag (`:1` or `:v1`) without an explicit
 * `inputs.*` enable gate.
 */
export function isUngatedMajorOnlyRule(ruleText) {
  const normalized = String(ruleText).trim();
  if (!MAJOR_ONLY_PATTERN_RE.test(normalized)) {
    return false;
  }
  return !EXPLICIT_INPUT_GATE_RE.test(normalized);
}

/**
 * Validates the container tag policy of `.github/workflows/release.yml`.
 */
export function validateReleaseImageTagPolicy(workflowText) {
  const rules = extractMetadataTagRules(workflowText);
  const violations = [];

  if (rules.length === 0) {
    return {
      ok: false,
      rules,
      violations: ["release workflow is missing a docker/metadata-action tags block"],
    };
  }

  const hasRefTag = rules.some((entry) => entry.rule === "type=ref,event=tag");
  const hasFullSemverVersion = rules.some(
    (entry) => entry.rule === "type=semver,pattern={{version}}",
  );

  if (!hasRefTag) {
    violations.push('missing immutable tag rule "type=ref,event=tag"');
  }
  if (!hasFullSemverVersion) {
    violations.push('missing immutable version rule "type=semver,pattern={{version}}"');
  }

  for (const entry of rules) {
    if (isUngatedMajorOnlyRule(entry.rule)) {
      violations.push(
        `line ${entry.line}: mutable major-only tag rule "${entry.rule}" must be removed or gated behind an explicit release input (enable=\${{ inputs.publish_major_tag == true }})`,
      );
    }
  }

  return {
    ok: violations.length === 0,
    rules,
    violations,
  };
}

/**
 * Computes the container image tags for a release tag (`vMAJOR.MINOR.PATCH`),
 * retaining immutable version tags by default and omitting the moving major
 * tag unless `allowMovingMajorTag: true` is explicitly passed.
 */
export function computeReleaseContainerTags({
  image = "ghcr.io/karagozemin/oversync-resolver",
  tag,
  allowMovingMajorTag = false,
}) {
  const match = String(tag ?? "")
    .trim()
    .match(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) {
    throw new Error(`Invalid release tag "${tag}"; expected vMAJOR.MINOR.PATCH`);
  }

  const [, major, minor, patch] = match;
  const tags = [
    `${image}:v${major}.${minor}.${patch}`,
    `${image}:${major}.${minor}.${patch}`,
    `${image}:${major}.${minor}`,
  ];

  if (allowMovingMajorTag) {
    tags.push(`${image}:${major}`);
  }

  return tags;
}
