import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  REQUIRED_OCI_LABEL_KEYS,
  validateOciImageLabels,
} from "./oci-image-labels.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("OCI source, revision, version, and license labels", () => {
  it("populates all required OCI labels in release.yml and both service Dockerfiles", () => {
    const releaseWorkflowText = readFileSync(
      resolve(repoRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    const dockerfiles = ["resolver/Dockerfile", "relayer/Dockerfile"].map(
      (path) => ({
        path,
        content: readFileSync(resolve(repoRoot, path), "utf8"),
      }),
    );

    const result = validateOciImageLabels({ releaseWorkflowText, dockerfiles });
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.deepEqual(result.workflowKeys, [...REQUIRED_OCI_LABEL_KEYS]);
  });

  it("flags missing OCI labels in release.yml or service Dockerfiles", () => {
    const result = validateOciImageLabels({
      releaseWorkflowText:
        "labels: ${{ steps.meta.outputs.labels }}\norg.opencontainers.image.source=https://github.com/karagozemin/OverSync\n",
      dockerfiles: [
        {
          path: "resolver/Dockerfile",
          content: "FROM node:22-alpine\nUSER node\n",
        },
      ],
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.violations.some((v) =>
        v.includes(
          'release.yml is missing OCI label "org.opencontainers.image.revision"',
        ),
      ),
    );
    assert.ok(
      result.violations.some((v) =>
        v.includes(
          'resolver/Dockerfile is missing OCI label "org.opencontainers.image.licenses"',
        ),
      ),
    );
  });
});
