/**
 * Validates that `.github/workflows/release.yml` configures
 * `docker/build-push-action` to emit an image provenance attestation tied to
 * the published digest (`provenance: true` or `provenance: mode=max`)
 * (issue #396).
 */

export function parseReleaseProvenanceConfig(workflowText) {
  const source = String(workflowText ?? "");
  const buildBlockMatch = source.match(
    /- name:\s*Build \+ push[\s\S]*?(?=\n\s{6}-\s|\n\s{2}[A-Za-z0-9_-]+:|$)/,
  );
  if (!buildBlockMatch) {
    return { found: false, provenance: null, push: null };
  }

  const block = buildBlockMatch[0];
  const provMatch = block.match(/^\s*provenance:\s*(.+?)\s*$/m);
  const pushMatch = block.match(/^\s*push:\s*(\S+)\s*$/m);

  return {
    found: true,
    provenance: provMatch ? provMatch[1].replace(/^['"]|['"]$/g, "") : null,
    push: pushMatch ? pushMatch[1] : null,
  };
}

export function validateReleaseProvenance(workflowText) {
  const violations = [];
  const parsed = parseReleaseProvenanceConfig(workflowText);

  if (!parsed.found) {
    violations.push('release.yml is missing step "Build + push"');
    return { ok: false, provenance: null, violations };
  }

  if (parsed.push !== "true") {
    violations.push('"Build + push" must have push: true so provenance attaches to the published digest');
  }

  if (!parsed.provenance) {
    violations.push('"Build + push" must explicitly enable provenance attestation (e.g. provenance: mode=max)');
  } else if (
    parsed.provenance === "false" ||
    !/^(true|mode=(min|max))$/.test(parsed.provenance)
  ) {
    violations.push(
      `"Build + push" provenance must be "true", "mode=min", or "mode=max" (got "${parsed.provenance}")`,
    );
  }

  return {
    ok: violations.length === 0,
    provenance: parsed.provenance,
    violations,
  };
}
