/**
 * Validates that `.github/workflows/release.yml` retains immutable version
 * container tags (`type=ref,event=tag` and `type=semver,pattern={{version}}`)
 * and never publishes an un-gated mutable major-only (`pattern={{major}}`) or
 * `latest` tag (issue #403).
 */

export function parseReleaseMetadataTagRules(workflowText) {
  const source = String(workflowText ?? "");
  const metaMatch = source.match(
    /- name:\s*Extract metadata[\s\S]*?(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!metaMatch) {
    return [];
  }

  const block = metaMatch[0];
  const tagsIdx = block.search(/^\s*tags:\s*\|/m);
  if (tagsIdx === -1) {
    return [];
  }

  const after = block.slice(tagsIdx).split(/\r?\n/).slice(1);
  const rules = [];
  for (const line of after) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s{12,}\S/.test(line)) break;
    rules.push(line.trim());
  }
  return rules;
}

export function validateReleaseContainerTags(workflowText) {
  const violations = [];
  const rules = parseReleaseMetadataTagRules(workflowText);

  if (rules.length === 0) {
    violations.push('release.yml "Extract metadata" is missing a tags block');
    return { ok: false, rules: [], violations };
  }

  if (!rules.includes("type=ref,event=tag")) {
    violations.push(
      'release.yml must retain immutable ref tag rule "type=ref,event=tag"',
    );
  }

  if (!rules.includes("type=semver,pattern={{version}}")) {
    violations.push(
      'release.yml must retain immutable version tag rule "type=semver,pattern={{version}}"',
    );
  }

  if (!rules.some((r) => r.startsWith("flavor:") || r.includes("latest=false"))) {
    // Also check if flavor: latest=false is set in Extract metadata block
    const metaBlock =
      String(workflowText ?? "").match(
        /- name:\s*Extract metadata[\s\S]*?(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/,
      )?.[0] ?? "";
    if (!/flavor:\s*\|?\s*\r?\n\s*latest=false/.test(metaBlock)) {
      violations.push(
        'release.yml "Extract metadata" must set flavor: latest=false to avoid mutable latest tags',
      );
    }
  }

  for (const rule of rules) {
    const isMajorOnly =
      /pattern=\{\{major\}\}(?!\.)/.test(rule) || /pattern=v\{\{major\}\}(?!\.)/.test(rule);
    if (isMajorOnly) {
      const isGated =
        /enable=\$\{\{\s*inputs\.publish_major_tag\s*==\s*true\s*\}\}/.test(
          rule,
        );
      if (!isGated) {
        violations.push(
          `release.yml tag rule "${rule}" publishes a mutable major-only tag without an explicit inputs.publish_major_tag gate`,
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
