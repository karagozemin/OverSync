import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  buildPrServiceImagePlan,
  inspectServiceDockerfile,
  validatePrServiceImagePlan,
} from "./pr-service-images.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-pr-service-images.mjs");

describe("PR service image no-push builds for resolver and relayer", () => {
  it("builds a validated no-push Docker build plan covering both resolver and relayer", () => {
    const plan = buildPrServiceImagePlan({ repoRoot, tagSuffix: "2c4f099" });
    const validation = validatePrServiceImagePlan(plan);

    assert.equal(validation.ok, true, `unexpected violations: ${validation.violations.join("; ")}`);
    assert.deepEqual(
      plan.builds.map((b) => b.service),
      ["resolver", "relayer"],
    );

    for (const item of plan.builds) {
      assert.equal(item.push, false);
      assert.equal(item.dockerArgs.includes("--push"), false);
      assert.equal(item.dockerArgs.includes("--load"), true);
      assert.ok(item.stages.includes("builder"));
      assert.ok(item.stages.includes("runtime"));
    }
  });

  it("rejects plans that omit either resolver or relayer", () => {
    const resolverOnly = buildPrServiceImagePlan({
      repoRoot,
      services: ["resolver"],
    });
    const checkResolverOnly = validatePrServiceImagePlan(resolverOnly);
    assert.equal(checkResolverOnly.ok, false);
    assert.match(checkResolverOnly.violations[0], /missing required service "relayer"/);

    const relayerOnly = buildPrServiceImagePlan({
      repoRoot,
      services: ["relayer"],
    });
    const checkRelayerOnly = validatePrServiceImagePlan(relayerOnly);
    assert.equal(checkRelayerOnly.ok, false);
    assert.match(checkRelayerOnly.violations[0], /missing required service "resolver"/);
  });

  it("rejects any service build that enables push or passes --push", () => {
    const plan = buildPrServiceImagePlan({ repoRoot });
    const withPushTrue = {
      ...plan,
      builds: plan.builds.map((b, i) => (i === 0 ? { ...b, push: true } : b)),
    };
    assert.equal(validatePrServiceImagePlan(withPushTrue).ok, false);

    const withPushFlag = {
      ...plan,
      builds: plan.builds.map((b, i) =>
        i === 1 ? { ...b, dockerArgs: [...b.dockerArgs, "--push"] } : b,
      ),
    };
    assert.equal(validatePrServiceImagePlan(withPushFlag).ok, false);
  });

  it("inspects multi-stage Dockerfiles and verifies host COPY sources exist", () => {
    for (const relPath of ["resolver/Dockerfile", "relayer/Dockerfile"]) {
      const content = readFileSync(resolve(repoRoot, relPath), "utf8");
      const parsed = inspectServiceDockerfile(content);
      assert.deepEqual(parsed.stages, ["builder", "runtime"]);
      assert.ok(parsed.hostCopies.includes("package.json"));
      assert.ok(parsed.hostCopies.includes("src"));
    }
  });

  it("executes the CLI check and wires check:pr-images into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript, "--tag", "2c4f099"], {
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /\[pr-image:resolver\] push=false/);
    assert.match(run.stdout, /\[pr-image:relayer\] push=false/);
    assert.equal(run.stdout.includes("--push"), false);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:pr-images"], "node scripts/check-pr-service-images.mjs");
  });
});
