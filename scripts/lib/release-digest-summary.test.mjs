import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  formatReleaseDigestSummary,
  verifyReleaseDigestSummaryWorkflow,
} from "./release-digest-summary.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = resolve(repoRoot, ".github/workflows/release.yml");
const scriptPath = resolve(repoRoot, "scripts/lib/release-digest-summary.mjs");

const SAMPLE_DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("release container image digest summary (#375)", () => {
  it("formats the immutable image digest and tag list as markdown", () => {
    const summary = formatReleaseDigestSummary({
      digest: SAMPLE_DIGEST,
      tags: [
        "ghcr.io/karagozemin/oversync-resolver:v1.2.3",
        "ghcr.io/karagozemin/oversync-resolver:1.2.3",
      ],
    });

    assert.match(summary, /## Published Resolver Container Image/);
    assert.ok(summary.includes(SAMPLE_DIGEST));
    assert.ok(
      summary.includes(
        `ghcr.io/karagozemin/oversync-resolver@${SAMPLE_DIGEST}`,
      ),
    );
  });

  it("rejects missing or malformed sha256 digests and empty tag lists", () => {
    assert.throws(
      () =>
        formatReleaseDigestSummary({
          digest: "sha256:short",
          tags: ["ghcr.io/karagozemin/oversync-resolver:v1.0.0"],
        }),
      /Invalid or missing container image digest/,
    );
    assert.throws(
      () =>
        formatReleaseDigestSummary({
          digest: SAMPLE_DIGEST,
          tags: [],
        }),
      /requires at least one published image tag/,
    );
  });

  it("wires build digest and metadata tags into $GITHUB_STEP_SUMMARY in release.yml", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const check = verifyReleaseDigestSummaryWorkflow(workflow);
    assert.equal(
      check.ok,
      true,
      `unexpected workflow violations: ${check.violations.join("; ")}`,
    );
  });

  it("prints the summary via CLI when IMAGE_DIGEST and IMAGE_TAGS are set", () => {
    const run = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        IMAGE_DIGEST: SAMPLE_DIGEST,
        IMAGE_TAGS:
          "ghcr.io/karagozemin/oversync-resolver:v1.2.3\nghcr.io/karagozemin/oversync-resolver:1.2.3",
      },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stdout.includes(SAMPLE_DIGEST));
  });
});
