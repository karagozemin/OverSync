import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  checkDockerfileRuntimeUser,
  findStageStarts,
  parseUserDirective,
} from "./dockerfile-users.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** A two-stage Dockerfile whose final stage is `body` (multi-line). */
const twoStage = (body) => `FROM node:22-alpine AS builder\nWORKDIR /app\n\n${body}`;

test("findStageStarts locates every FROM directive", () => {
  const content = "FROM alpine AS a\nRUN x\nFROM alpine AS b\nRUN y\n";
  assert.deepEqual(findStageStarts(content), [0, 2]);
  assert.deepEqual(findStageStarts("# FROM not a directive\nUSER root"), []);
});

test("parseUserDirective reads user and user:group specs", () => {
  assert.equal(parseUserDirective("USER node"), "node");
  assert.equal(parseUserDirective("  USER 1000:1000"), "1000:1000");
  assert.equal(parseUserDirective("# USER node"), null);
  assert.equal(parseUserDirective("RUN echo USER node"), null);
});

test("missing USER directive in the final stage is an error", () => {
  assert.deepEqual(
    checkDockerfileRuntimeUser(twoStage('CMD ["x"]'), "a/Dockerfile"),
    ["a/Dockerfile: final build stage declares no USER — image would run as root"],
  );
});

test("last-stage USER root is an error", () => {
  for (const spec of ["root", "0", "0:0"]) {
    assert.deepEqual(
      checkDockerfileRuntimeUser(twoStage(`ENV A=1\nUSER ${spec}\nCMD ["x"]`), "a/Dockerfile"),
      ["a/Dockerfile: final USER directive is root — must end on a non-root user"],
    );
  }
});

test("non-root node and numeric users pass", () => {
  assert.deepEqual(
    checkDockerfileRuntimeUser(twoStage("USER node\nCMD [\"x\"]"), "a/Dockerfile"),
    [],
  );
  assert.deepEqual(
    checkDockerfileRuntimeUser(twoStage("USER 1000\nUSER node:node"), "a/Dockerfile"),
    [],
  );
});

test("root in builder stages does not affect the final stage check", () => {
  const content = [
    "FROM node:22-alpine AS builder",
    "USER root",
    "RUN npm install",
    "",
    "FROM node:22-alpine AS runtime",
    "USER node",
    'CMD ["npm", "start"]',
  ].join("\n");
  assert.deepEqual(checkDockerfileRuntimeUser(content, "a/Dockerfile"), []);
});

test("a final-stage root fallthrough is still an error even with root in builder", () => {
  const content = [
    "FROM node:22-alpine AS builder",
    "USER root",
    "RUN npm install",
    "",
    "FROM node:22-alpine AS runtime",
    'ENTRYPOINT ["node"]',
  ].join("\n");
  assert.notDeepEqual(checkDockerfileRuntimeUser(content, "a/Dockerfile"), []);
});

test("USER keywords are case-insensitive", () => {
  assert.deepEqual(
    checkDockerfileRuntimeUser("from node:22-alpine\nuser node\n", "a/Dockerfile"),
    [],
  );
});

// The actual repository Dockerfiles must satisfy the policy the check
// enforces (issue #376).
for (const file of ["relayer/Dockerfile", "resolver/Dockerfile"]) {
  test(`${file} ends its runtime stage as a non-root user`, () => {
    const content = readFileSync(resolve(repoRoot, file), "utf8");
    const errors = checkDockerfileRuntimeUser(content, file);

    assert.deepEqual(errors, []);

    // The USER directive must come after the last FROM, i.e. really apply
    // to the image that runs.
    const stageStarts = findStageStarts(content);
    assert.ok(stageStarts.length > 0);
    const runtime = content
      .split(/\r?\n/)
      .slice(stageStarts[stageStarts.length - 1])
      .join("\n");
    assert.match(runtime, /^\s*USER\s+\S+/m, `${file} runtime stage lacks USER`);
  });
}
