import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function serviceImagesJob(workflow) {
  const match = workflow.match(/service-images:[\s\S]*?(?=\n {2}[A-Za-z0-9_-]+:|$)/);
  assert.ok(match, "service-images job is missing from ci.yml");
  return match[0];
}

function buildStepBlock(job, stepName) {
  const marker = `      - name: ${stepName}`;
  const start = job.indexOf(marker);
  assert.notEqual(start, -1, `expected build step "${stepName}"`);
  const rest = job.slice(start);
  const next = rest.search(/\n      - name: |\n {2}[A-Za-z0-9_-]+:|$/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("PR service image builds", () => {
  it("builds resolver and relayer images with push disabled", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const job = serviceImagesJob(workflow);

    assert.equal(job.includes("docker/login-action"), false, "PR builds must not log in to a registry");
    assert.equal(job.includes("packages: write"), false, "PR builds must not request packages:write");

    for (const [stepName, context] of [
      ["Build resolver image", "./resolver"],
      ["Build relayer image", "./relayer"],
    ]) {
      const step = buildStepBlock(job, stepName);
      assert.match(step, new RegExp(`context:\\s*${context.replace(".", "\\.")}`));
      assert.match(step, /push:\s*false/);
      assert.equal(step.includes("push: true"), false);
    }
  });
});
