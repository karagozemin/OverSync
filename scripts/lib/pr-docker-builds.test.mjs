import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  REQUIRED_SERVICE_DOCKER_BUILDS,
  validatePrDockerBuilds,
} from "./pr-docker-builds.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ciWorkflowPath = resolve(repoRoot, ".github/workflows/ci.yml");

describe("PR no-push Docker service image builds", () => {
  it("builds both resolver and relayer Docker images with push: false in ci.yml", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const result = validatePrDockerBuilds(workflow);
    assert.equal(
      result.ok,
      true,
      `unexpected violations: ${result.violations.join("; ")}`,
    );
    assert.equal(result.builds.length, REQUIRED_SERVICE_DOCKER_BUILDS.length);
  });

  it("rejects workflows missing either service image build or enabling push: true", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8");
    const pushEnabled = workflow.replace("push: false", "push: true");
    const res1 = validatePrDockerBuilds(pushEnabled);
    assert.equal(res1.ok, false);
    assert.ok(res1.violations.some((v) => v.includes("must set push: false")));

    const missingRelayer = workflow.replace(
      "file: ./relayer/Dockerfile",
      "file: ./other/Dockerfile",
    );
    const res2 = validatePrDockerBuilds(missingRelayer);
    assert.equal(res2.ok, false);
    assert.ok(
      res2.violations.some((v) =>
        v.includes("missing a docker/build-push-action step for relayer"),
      ),
    );
  });
});
