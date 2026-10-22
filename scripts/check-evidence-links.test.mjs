import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const checkerPath = fileURLToPath(new URL("./check-evidence-links.mjs", import.meta.url));

function runChecker(readme) {
  const root = mkdtempSync(join(tmpdir(), "oversync-evidence-links-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "docs"));
    copyFileSync(checkerPath, join(root, "scripts/check-evidence-links.mjs"));
    writeFileSync(join(root, "README.md"), readme);
    writeFileSync(join(root, "ROADMAP.md"), "");
    writeFileSync(join(root, "ARCHITECTURE.md"), "");
    writeFileSync(join(root, "docs/fixture.md"), "# Fixture\n");

    return spawnSync(process.execPath, [join(root, "scripts/check-evidence-links.mjs")], {
      encoding: "utf8"
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts valid links using only local fixture files", () => {
  const result = runChecker("[fixture](docs/fixture.md#Fixture)\n");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /All links are valid/);
});

test("fails for a missing local target using only local fixture files", () => {
  const result = runChecker("[missing](docs/missing.md)\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /File not found: docs\/missing\.md/);
});