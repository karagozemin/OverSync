import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function releaseJobBlock(workflow) {
  const match = workflow.match(/resolver-docker:[\s\S]*?(?=\n {2}[A-Za-z0-9_-]+:|$)/);
  assert.ok(match, "resolver-docker job is missing");
  return match[0];
}

describe("release job timeout", () => {
  it("sets a bounded timeout on the container release job", () => {
    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
    const job = releaseJobBlock(workflow);
    const timeout = job.match(/timeout-minutes:\s*(\d+)/);
    assert.ok(timeout, "resolver-docker is missing timeout-minutes");
    const minutes = Number(timeout[1]);
    assert.ok(minutes >= 15 && minutes <= 60, `timeout ${minutes} is outside 15–60 minutes`);
  });
});
