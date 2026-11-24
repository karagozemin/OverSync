import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  REQUIRED_OCI_LABELS,
  checkDockerfileOciLabels,
  logicalInstructions,
  parseLabelPairs,
} from "./dockerfile-oci-labels.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const GOOD_RUNTIME = [
  "FROM node:22-alpine AS builder",
  "RUN npm install",
  "",
  "FROM node:22-alpine AS runtime",
  "ARG OCI_SOURCE=https://github.com/example/repo",
  "ARG OCI_REVISION=unknown",
  "ARG OCI_VERSION=dev",
  'LABEL org.opencontainers.image.source="${OCI_SOURCE}" \\',
  '      org.opencontainers.image.revision="${OCI_REVISION}" \\',
  "      org.opencontainers.image.version=$OCI_VERSION \\",
  '      org.opencontainers.image.licenses="MIT"',
  "USER node",
  'CMD ["node", "dist/index.js"]',
].join("\n");

test("logicalInstructions joins line continuations and skips comments", () => {
  assert.deepEqual(logicalInstructions("# c\nFROM a\n\nLABEL x=1 \\\n  y=2\nUSER node\n"), [
    "FROM a",
    "LABEL x=1 y=2",
    "USER node",
  ]);
});

test("parseLabelPairs reads quoted and unquoted values", () => {
  const labels = parseLabelPairs('a.b="${X}" c=plain d="with space"');
  assert.equal(labels.get("a.b"), "${X}");
  assert.equal(labels.get("c"), "plain");
  assert.equal(labels.get("d"), "with space");
});

test("a final stage with all OCI labels wired to ARGs passes", () => {
  assert.deepEqual(checkDockerfileOciLabels(GOOD_RUNTIME, "a/Dockerfile"), []);
});

test("each missing OCI label is reported", () => {
  for (const key of REQUIRED_OCI_LABELS) {
    const content = GOOD_RUNTIME.split("\n")
      .filter((line) => !line.includes(`${key}=`))
      .join("\n")
      // Keep the LABEL instruction well-formed after dropping a line.
      .replace(/\\\nUSER/, "\nUSER");
    const errors = checkDockerfileOciLabels(content, "a/Dockerfile");
    assert.ok(
      errors.includes(`a/Dockerfile: final build stage is missing LABEL ${key}`),
      `expected missing ${key}, got ${JSON.stringify(errors)}`,
    );
  }
});

test("labels declared only in a builder stage do not count", () => {
  const content = [
    "FROM node:22-alpine AS builder",
    "ARG OCI_REVISION=unknown",
    'LABEL org.opencontainers.image.revision="${OCI_REVISION}"',
    "FROM node:22-alpine AS runtime",
    "USER node",
  ].join("\n");
  const errors = checkDockerfileOciLabels(content, "a/Dockerfile");
  assert.equal(errors.length, REQUIRED_OCI_LABELS.length);
});

test("hard-coded source/revision/version values are rejected", () => {
  const content = GOOD_RUNTIME.replace('"${OCI_REVISION}"', '"abc123"');
  assert.deepEqual(checkDockerfileOciLabels(content, "a/Dockerfile"), [
    "a/Dockerfile: LABEL org.opencontainers.image.revision must be set from a build ARG",
  ]);
});

test("labels referencing an undeclared or later ARG are rejected", () => {
  const content = GOOD_RUNTIME.replace("ARG OCI_VERSION=dev\n", "").replace(
    "USER node",
    "ARG OCI_VERSION=dev\nUSER node",
  );
  assert.deepEqual(checkDockerfileOciLabels(content, "a/Dockerfile"), [
    "a/Dockerfile: LABEL org.opencontainers.image.version references an ARG not declared earlier in the final build stage",
  ]);
});

test("a Dockerfile without FROM is an error", () => {
  assert.deepEqual(checkDockerfileOciLabels("USER node\n", "a/Dockerfile"), [
    "a/Dockerfile: no FROM stage found",
  ]);
});

for (const file of ["relayer/Dockerfile", "resolver/Dockerfile"]) {
  test(`${file} declares OCI source, revision, version, and licenses labels`, () => {
    const content = readFileSync(resolve(repoRoot, file), "utf8");
    assert.deepEqual(checkDockerfileOciLabels(content, file), []);
    assert.match(content, /org\.opencontainers\.image\.licenses="MIT"/);
  });
}

test("release workflow passes OCI build args to the resolver image build", () => {
  const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  assert.match(workflow, /OCI_SOURCE=\$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}/);
  assert.match(workflow, /OCI_REVISION=\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /OCI_VERSION=\$\{\{ steps\.meta\.outputs\.version \}\}/);
  assert.match(workflow, /org\.opencontainers\.image\.licenses=MIT/);
  assert.match(workflow, /labels: \$\{\{ steps\.meta\.outputs\.labels \}\}/);
});
