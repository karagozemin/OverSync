import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

test("print-deployments exits successfully for testnet", () => {
  const result = spawnSync(
    process.execPath,
    ["soroban/scripts/print-deployments.mjs", "testnet"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OverSync — Soroban Deployment Verification/);
});
