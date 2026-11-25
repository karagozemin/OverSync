import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  TARGET_DOCKERFILES,
  lintDockerfile,
  parseHadolintConfig,
  validateHadolintConfig,
} from "./dockerfile-lint.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-dockerfiles.mjs");

describe("resolver and relayer Dockerfile linting", () => {
  it("validates the reviewed .hadolint.yaml configuration and lints both service Dockerfiles cleanly", () => {
    const configText = readFileSync(resolve(repoRoot, ".hadolint.yaml"), "utf8");
    const config = parseHadolintConfig(configText);
    const configCheck = validateHadolintConfig(config);

    assert.equal(configCheck.ok, true, `unexpected config errors: ${configCheck.violations.join("; ")}`);
    assert.equal(config.failureThreshold, "warning");

    for (const relPath of TARGET_DOCKERFILES) {
      const content = readFileSync(resolve(repoRoot, relPath), "utf8");
      const result = lintDockerfile(content, { file: relPath, config });
      assert.equal(
        result.ok,
        true,
        `unexpected findings in ${relPath}: ${JSON.stringify(result.blockingFindings)}`,
      );
    }
  });

  it("blocks high-severity error and warning findings in malformed Dockerfiles", () => {
    const badDockerfile = [
      "FROM node:latest AS builder",
      "WORKDIR app",
      "ADD package.json ./",
      "RUN sudo npm install",
      "CMD npm start",
    ].join("\n");

    const result = lintDockerfile(badDockerfile, { file: "bad/Dockerfile" });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.blockingFindings.map((f) => f.code),
      ["DL3007", "DL3000", "DL3020", "DL3004", "DL3025"],
    );
  });

  it("flags untagged FROM images and undeclared COPY --from aliases", () => {
    const untagged = [
      "FROM node AS runtime",
      "WORKDIR /app",
      "COPY --from=missing-stage /app/dist ./dist",
      'CMD ["node", "dist/index.js"]',
    ].join("\n");

    const result = lintDockerfile(untagged, { file: "untagged/Dockerfile" });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.blockingFindings.map((f) => f.code),
      ["DL3006", "DL3022"],
    );
  });

  it("rejects non-blocking failure thresholds or overly broad ignore lists in .hadolint.yaml", () => {
    const permissive = parseHadolintConfig("failure-threshold: style\ntrustedRegistries:\n  - docker.io\n");
    assert.equal(validateHadolintConfig(permissive).ok, false);

    const tooManyIgnores = parseHadolintConfig(
      [
        "failure-threshold: warning",
        "trustedRegistries:",
        "  - docker.io",
        "ignored:",
        "  - DL3000",
        "  - DL3004",
        "  - DL3006",
        "  - DL3007",
        "  - DL3018",
        "  - DL3020",
      ].join("\n"),
    );
    assert.equal(validateHadolintConfig(tooManyIgnores).ok, false);
  });

  it("executes the CLI check and wires lint:docker into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Linted 2 Dockerfile\(s\)/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["lint:docker"], "node scripts/check-dockerfiles.mjs");
  });
});
