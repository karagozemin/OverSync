/**
 * Validates container tag rules in `.github/workflows/release.yml` (issue #403).
 *
 * Ensures that moving major-only tags (`pattern={{major}}`) are never published
 * unconditionally on tag pushes, and that immutable version/ref/sha tags are
 * retained.
 */

export function parseReleaseMetadataTagRules(workflowText) {
  const source = String(workflowText);
  const blockMatch = source.match(/tags:\s*\|\r?\n((?:\s{12,}[^\r\n]+\r?\n?)+)/);
  if (!blockMatch) {
    return [];
  }
  return blockMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function validateReleaseContainerTagPolicy(workflowText) {
  const rules = parseReleaseMetadataTagRules(workflowText);
  const violations = [];

  if (rules.length === 0) {
    violations.push("release.yml is missing docker/metadata-action tags block");
    return { ok: false, rules, violations };
  }

  if (!rules.some((r) => r.includes("type=ref,event=tag"))) {
    violations.push("release.yml must retain immutable ref tag rule (type=ref,event=tag)");
  }

  if (!rules.some((r) => r.includes("type=semver,pattern={{version}}"))) {
    violations.push("release.yml must retain full version tag rule (type=semver,pattern={{version}})");
  }

  for (const rule of rules) {
    const isMajorOnly =
      /pattern=\{\{major\}\}(?!\.\{\{minor\}\})/.test(rule) ||
      /pattern=v\{\{major\}\}(?!\.\{\{minor\}\})/.test(rule);
    if (isMajorOnly) {
      const isGated =
        /enable=\$\{\{\s*inputs\.publish_major_tag\s*==\s*true\s*\}\}/.test(
          rule,
        ) || /enable=false/.test(rule);
      if (!isGated) {
        violations.push(
          `unconditional mutable major-only tag rule is forbidden: "${rule}"`,
        );
      }
    }
  }

  return {
    ok: violations.length === 0,
    rules,
    violations,
  };
}
