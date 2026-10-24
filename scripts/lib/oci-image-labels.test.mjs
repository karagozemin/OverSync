import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  REQUIRED_OCI_LABEL_KEYS,
  buildOciImageLabels,
  normalizeRepositorySourceUrl,
  validateDockerfileOciLabels,
} from "./oci-image-labels.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliScript = resolve(repoRoot, "scripts/check-oci-labels.mjs");

describe("OCI image source and revision labels", () => {
  it("populates source, revision, version, and licenses labels in resolver and relayer Dockerfiles", () => {
    for (const relPath of ["resolver/Dockerfile", "relayer/Dockerfile"]) {
      const content = readFileSync(resolve(repoRoot, relPath), "utf8");
      const result = validateDockerfileOciLabels(content, { name: relPath });

      assert.equal(
        result.ok,
        true,
        `unexpected violations in ${relPath}: ${result.violations.join("; ")}`,
      );
      for (const key of REQUIRED_OCI_LABEL_KEYS) {
        assert.ok(result.resolvedLabels[key], `${relPath} is missing ${key}`);
      }
      assert.equal(
        result.resolvedLabels["org.opencontainers.image.source"],
        "https://github.com/karagozemin/OverSync",
      );
      assert.equal(result.resolvedLabels["org.opencontainers.image.licenses"], "MIT");
    }
  });

  it("builds concrete OCI labels and Docker build flags from repository metadata and commit SHA", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const built = buildOciImageLabels({
      title: "oversync-resolver",
      source: normalizeRepositorySourceUrl(pkg.repository.url),
      revision: "2c4f0992fcce82505b26329f439870d00ed9451e",
      version: "v1.2.3",
      licenses: pkg.license,
    });

    assert.equal(built.ok, true);
    assert.deepEqual(built.labels, {
      "org.opencontainers.image.title": "oversync-resolver",
      "org.opencontainers.image.source": "https://github.com/karagozemin/OverSync",
      "org.opencontainers.image.revision": "2c4f0992fcce82505b26329f439870d00ed9451e",
      "org.opencontainers.image.version": "1.2.3",
      "org.opencontainers.image.licenses": "MIT",
    });
    assert.ok(
      built.dockerFlags.includes(
        "org.opencontainers.image.revision=2c4f0992fcce82505b26329f439870d00ed9451e",
      ),
    );
  });

  it("rejects Dockerfiles missing any required OCI label", () => {
    const incompleteDockerfile = [
      "FROM node:22-alpine AS runtime",
      'LABEL org.opencontainers.image.title="oversync-resolver"',
      'LABEL org.opencontainers.image.source="https://github.com/karagozemin/OverSync"',
    ].join("\n");

    const result = validateDockerfileOciLabels(incompleteDockerfile, {
      name: "incomplete.Dockerfile",
    });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 3);
  });

  it("rejects malformed repository URLs, commit revisions, or versions", () => {
    const bad = buildOciImageLabels({
      source: "http://example.com/not-github",
      revision: "not-a-hex-sha!",
      version: "invalid",
      licenses: "",
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.errors.length, 4);
  });

  it("runs the CLI check and wires check:oci-labels into package.json", () => {
    const run = spawnSync(process.execPath, [cliScript], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Verified standard OCI labels/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:oci-labels"], "node scripts/check-oci-labels.mjs");
  });
});
