import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { findDuplicateEnvKeys, parseEnvKeys } from "./env-keys.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("parseEnvKeys", () => {
  it("returns declared keys with 1-based line numbers", () => {
    const keys = parseEnvKeys("FOO=1\n\nBAR=\n");
    assert.deepEqual(keys, [
      { name: "FOO", line: 1 },
      { name: "BAR", line: 3 },
    ]);
  });

  it("ignores comments, blank lines and lines without =", () => {
    const keys = parseEnvKeys("# KEY=commented-out\n\n   # indented comment\nNOT A KEY\nFOO=1\n");
    assert.deepEqual(keys, [{ name: "FOO", line: 5 }]);
  });

  it("ignores commented-out example keys", () => {
    // env.example documents option-style examples like "#   INFURA_API_KEY=...".
    const keys = parseEnvKeys("#   INFURA_API_KEY=your_project_key\nINFURA_API_KEY=\n");
    assert.deepEqual(keys, [{ name: "INFURA_API_KEY", line: 2 }]);
  });

  it("skips keys that are not upper-case env-style identifiers", () => {
    const keys = parseEnvKeys("lowercase=1\n1BAD=2\nVITE_OK=3\n");
    assert.deepEqual(keys, [{ name: "VITE_OK", line: 3 }]);
  });
});

describe("findDuplicateEnvKeys", () => {
  it("accepts a document where every key appears once", () => {
    assert.deepEqual(findDuplicateEnvKeys("A=1\nB=2\n# A=commented\nC=3\n"), []);
  });

  it("rejects a repeated key and reports every line it appears on", () => {
    // The exact shape of the #355 bug: DATABASE_URL declared in the coordinator
    // section and again under a stray "Persistence" comment.
    const content = [
      "# Coordinator database URL",
      "DATABASE_URL=file:./oversync.db",
      "",
      "# Persistence (SQLite for dev, Postgres for prod).",
      "DATABASE_URL=file:./oversync.db",
    ].join("\n");

    assert.deepEqual(findDuplicateEnvKeys(content), [
      { name: "DATABASE_URL", lines: [2, 5] },
    ]);
  });

  it("reports every duplicated key, not just the first", () => {
    const content = "A=1\nA=2\nB=1\nB=2\n";
    assert.deepEqual(findDuplicateEnvKeys(content), [
      { name: "A", lines: [1, 2] },
      { name: "B", lines: [3, 4] },
    ]);
  });

  it("does not treat commented-out copies as duplicates", () => {
    const content = "FOO=1\n# FOO=override\n";
    assert.deepEqual(findDuplicateEnvKeys(content), []);
  });
});

describe("env.example", () => {
  it("declares each environment key exactly once", () => {
    // Regression guard for #355: DATABASE_URL (and any other key) must not be
    // declared twice, or operators edit one copy while deployment reads the
    // other.
    const content = readFileSync(resolve(repoRoot, "env.example"), "utf8");
    assert.deepEqual(findDuplicateEnvKeys(content), []);
  });
});
