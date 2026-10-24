import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildReleaseProvenanceConfig,
  parseReleaseBuildStep,
  validateReleaseProvenanceConfig,
} from "./release-provenance.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const cliScript = resolve(repoRoot, "scripts/check-release-provenance.mjs");
const SAMPLE_DIGEST =
  "sha256:2c4f0992fcce82505b26329f439870d00ed9451e2c4f0992fcce82505b26329f";

describe("release container provenance attestations", () => {
  it("parses the Buildx release step and builds a valid mode=max provenance attestation config", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const step = parseReleaseBuildStep(workflowText);

    assert.equal(step.action, "docker/build-push-action@v6");
    assert.equal(step.context, "./resolver");
    assert.equal(step.dockerfile, "./resolver/Dockerfile");
    assert.equal(step.push, true);

    const config = buildReleaseProvenanceConfig({
      workflowText,
      mode: "max",
      subjectDigest: SAMPLE_DIGEST,
    });
    const result = validateReleaseProvenanceConfig(config);

    assert.equal(result.ok, true, `unexpected errors: ${result.violations.join("; ")}`);
    assert.equal(config.provenance, "mode=max");
    assert.ok(config.dockerArgs.includes("--provenance=mode=max"));
  });

  it("rejects configurations where provenance is disabled or missing", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const base = buildReleaseProvenanceConfig({
      workflowText,
      subjectDigest: SAMPLE_DIGEST,
    });

    assert.equal(
      validateReleaseProvenanceConfig({ ...base, provenance: "false" }).ok,
      false,
    );
    assert.equal(
      validateReleaseProvenanceConfig({ ...base, provenance: "" }).ok,
      false,
    );
    assert.equal(
      validateReleaseProvenanceConfig({ ...base, push: false }).ok,
      false,
    );
  });

  it("requires a valid sha256 digest for the published image subject", () => {
    const workflowText = readFileSync(workflowPath, "utf8");
    const badDigestConfig = buildReleaseProvenanceConfig({
      workflowText,
      subjectDigest: "sha256:not-a-valid-digest",
    });

    const result = validateReleaseProvenanceConfig(badDigestConfig);
    assert.equal(result.ok, false);
    assert.match(result.violations[0], /subjectDigest must be a valid sha256 digest/);
  });

  it("executes the CLI check and wires check:release-provenance into package.json", () => {
    const okRun = spawnSync(
      process.execPath,
      [cliScript, "--digest", SAMPLE_DIGEST],
      { encoding: "utf8" },
    );
    assert.equal(okRun.status, 0, okRun.stderr);
    assert.match(okRun.stdout, /Verified release Buildx provenance attestation \(mode=max\)/);

    const failRun = spawnSync(
      process.execPath,
      [cliScript, "--digest", "invalid"],
      { encoding: "utf8" },
    );
    assert.equal(failRun.status, 1);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(
      pkg.scripts["check:release-provenance"],
      "node scripts/check-release-provenance.mjs",
    );
  });
});
