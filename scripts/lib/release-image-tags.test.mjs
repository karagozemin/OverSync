import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  computeReleaseContainerTags,
  extractMetadataTagRules,
  validateReleaseImageTagPolicy,
} from "./release-image-tags.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("release container image tag policy", () => {
  it("retains immutable version tags and avoids un-gated major-only tags in release.yml", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
    const result = validateReleaseImageTagPolicy(workflow);

    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    const rules = extractMetadataTagRules(workflow).map((r) => r.rule);
    assert.ok(rules.includes("type=ref,event=tag"));
    assert.ok(rules.includes("type=semver,pattern={{version}}"));
    assert.equal(
      rules.some((r) => /pattern=v?\{\{major\}\}(?:,|$)/.test(r)),
      false,
      "release.yml must not publish an un-gated major-only container tag",
    );
  });

  it("rejects workflows that publish an un-gated {{major}} or v{{major}} tag", () => {
    const badWorkflow = [
      "jobs:",
      "  resolver-docker:",
      "    steps:",
      "      - uses: docker/metadata-action@v5",
      "        with:",
      "          tags: |",
      "            type=ref,event=tag",
      "            type=semver,pattern={{version}}",
      "            type=semver,pattern={{major}}",
    ].join("\n");

    const result = validateReleaseImageTagPolicy(badWorkflow);
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0], /mutable major-only tag rule/);
  });

  it("accepts a major-only tag rule when gated behind an explicit release input", () => {
    const gatedWorkflow = [
      "jobs:",
      "  resolver-docker:",
      "    steps:",
      "      - uses: docker/metadata-action@v5",
      "        with:",
      "          tags: |",
      "            type=ref,event=tag",
      "            type=semver,pattern={{version}}",
      "            type=semver,pattern={{major}},enable=${{ inputs.publish_major_tag == true }}",
    ].join("\n");

    const result = validateReleaseImageTagPolicy(gatedWorkflow);
    assert.equal(result.ok, true);
  });

  it("rejects workflows that remove immutable version tags", () => {
    const missingImmutable = [
      "jobs:",
      "  resolver-docker:",
      "    steps:",
      "      - uses: docker/metadata-action@v5",
      "        with:",
      "          tags: |",
      "            type=semver,pattern={{major}}.{{minor}}",
    ].join("\n");

    const result = validateReleaseImageTagPolicy(missingImmutable);
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 2);
  });

  it("omits moving major tags by default and includes them only when explicitly requested", () => {
    const defaultTags = computeReleaseContainerTags({
      image: "ghcr.io/karagozemin/oversync-resolver",
      tag: "v1.2.3",
    });
    assert.deepEqual(defaultTags, [
      "ghcr.io/karagozemin/oversync-resolver:v1.2.3",
      "ghcr.io/karagozemin/oversync-resolver:1.2.3",
      "ghcr.io/karagozemin/oversync-resolver:1.2",
    ]);

    const gatedTags = computeReleaseContainerTags({
      image: "ghcr.io/karagozemin/oversync-resolver",
      tag: "v1.2.3",
      allowMovingMajorTag: true,
    });
    assert.ok(gatedTags.includes("ghcr.io/karagozemin/oversync-resolver:1"));
  });

  it("wires check:release-image-tags into package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:release-image-tags"],
      "node scripts/check-release-image-tags.mjs",
    );
  });
});
