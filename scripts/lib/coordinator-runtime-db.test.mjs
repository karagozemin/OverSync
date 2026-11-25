import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const gitIgnore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
const coordinatorReadme = readFileSync(resolve(repoRoot, "coordinator/README.md"), "utf8");
const tracked = execSync("git ls-files", { cwd: repoRoot, encoding: "utf8" });

const requiredPatterns = [
  "*.db",
  "*.db-journal",
  "*.db-wal",
  "*.db-shm",
  "*.sqlite",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "*.sqlite3",
  "*.sqlite3-wal",
  "*.sqlite3-shm",
];

test("runtime database files are ignored and never tracked", () => {
  for (const pattern of requiredPatterns) {
    assert.match(gitIgnore, new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), `missing ignore pattern: ${pattern}`);
  }

  assert.doesNotMatch(tracked, /(^|\n)coordinator\/oversync\.db(?:\n|$)/, "coordinator/oversync.db should not be tracked");
});

test("local coordinator setup documents the database as created on demand", () => {
  assert.match(coordinatorReadme, /created on demand|created automatically|write[s]? to .*oversync\.db.*when/i);
});
