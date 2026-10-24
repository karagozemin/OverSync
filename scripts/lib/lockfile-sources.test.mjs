import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  resolveWorkspaceLinkTarget,
  validateLockfileSources,
} from "./lockfile-sources.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("pnpm lockfile dependency source validation", () => {
  it("accepts the committed pnpm-lock.yaml including internal workspace links", () => {
    const lockfile = readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8");
    const result = validateLockfileSources(lockfile);

    assert.equal(result.ok, true, `unexpected violations: ${JSON.stringify(result.violations)}`);
    assert.ok(result.importerCount >= 9, `expected >= 9 importers, got ${result.importerCount}`);
    assert.ok(result.packageCount > 100, `expected > 100 packages, got ${result.packageCount}`);
  });

  it("normalizes internal workspace link paths relative to the importer", () => {
    assert.equal(resolveWorkspaceLinkTarget("coordinator", "link:../packages/sdk"), "packages/sdk");
    assert.equal(resolveWorkspaceLinkTarget("frontend", "link:../contracts"), "contracts");
    assert.equal(resolveWorkspaceLinkTarget(".", "link:packages/sdk"), "packages/sdk");
  });

  it("rejects git dependency sources in importers and packages", () => {
    const lockfile = [
      "lockfileVersion: '6.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      evil-git:",
      "        specifier: git+https://github.com/example/evil.git#main",
      "        version: github:example/evil#deadbeef",
      "packages:",
      "  /evil-git@1.0.0:",
      "    resolution: {type: git, repo: https://github.com/example/evil.git, commit: 0123456789abcdef}",
    ].join("\n");

    const result = validateLockfileSources(lockfile);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => ({ section: v.section, kind: v.kind, line: v.line })),
      [
        { section: "importers", kind: "git", line: 6 },
        { section: "importers", kind: "git", line: 7 },
        { section: "packages", kind: "git", line: 10 },
      ],
    );
  });

  it("rejects URL tarball dependency sources in importers and packages", () => {
    const lockfile = [
      "lockfileVersion: '6.0'",
      "importers:",
      "  coordinator:",
      "    dependencies:",
      "      remote-tarball:",
      "        specifier: https://evil.example.com/pkg-1.0.0.tgz",
      "        version: https://evil.example.com/pkg-1.0.0.tgz",
      "packages:",
      "  /remote-tarball@1.0.0:",
      "    resolution: {tarball: https://evil.example.com/pkg-1.0.0.tgz}",
    ].join("\n");

    const result = validateLockfileSources(lockfile);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => ({ section: v.section, kind: v.kind, line: v.line })),
      [
        { section: "importers", kind: "url-tarball", line: 6 },
        { section: "importers", kind: "url-tarball", line: 7 },
        { section: "packages", kind: "url-tarball", line: 10 },
      ],
    );
  });

  it("rejects file: and external link: local-path sources while allowing internal workspace links", () => {
    const lockfile = [
      "lockfileVersion: '6.0'",
      "importers:",
      "  packages/sdk:",
      "    dependencies: {}",
      "  coordinator:",
      "    dependencies:",
      "      '@oversync/sdk':",
      "        specifier: workspace:*",
      "        version: link:../packages/sdk",
      "      local-tar:",
      "        specifier: file:./vendor/local-tar.tgz",
      "        version: file:./vendor/local-tar.tgz",
      "      escaped-link:",
      "        specifier: link:../../outside-repo",
      "        version: link:../../outside-repo",
      "packages:",
      "  /local-dir@1.0.0:",
      "    resolution: {directory: ../outside-repo, type: directory}",
    ].join("\n");

    const result = validateLockfileSources(lockfile);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.violations.map((v) => ({ entry: v.entry, kind: v.kind, line: v.line })),
      [
        { entry: "coordinator:local-tar", kind: "local-path", line: 11 },
        { entry: "coordinator:local-tar", kind: "local-path", line: 12 },
        { entry: "coordinator:escaped-link", kind: "local-path", line: 14 },
        { entry: "coordinator:escaped-link", kind: "local-path", line: 15 },
        { entry: "/local-dir@1.0.0", kind: "local-path", line: 18 },
      ],
    );
  });

  it("rejects package entries without an integrity digest and supports explicit allowlist entries", () => {
    const lockfile = [
      "lockfileVersion: '6.0'",
      "importers:",
      "  .:",
      "    dependencies: {}",
      "packages:",
      "  /no-digest@1.0.0:",
      "    resolution: {}",
      "  /reviewed-pkg@1.0.0:",
      "    resolution: {tarball: https://example.com/reviewed-1.0.0.tgz}",
    ].join("\n");

    const result = validateLockfileSources(lockfile, { allowlist: ["/reviewed-pkg@1.0.0"] });
    assert.equal(result.ok, false);
    assert.equal(result.violations.length, 1);
    assert.equal(result.violations[0].entry, "/no-digest@1.0.0");
    assert.equal(result.violations[0].kind, "missing-integrity");
  });

  it("wires lockfile source validation into package.json and CI script tests", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["check:lockfile-sources"], "node scripts/check-lockfile-sources.mjs");
    assert.match(pkg.scripts["test:scripts"], /scripts\/lib\/\*\.test\.mjs/);

    const workflow = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
    assert.match(workflow, /pnpm test:scripts/);
  });
});
