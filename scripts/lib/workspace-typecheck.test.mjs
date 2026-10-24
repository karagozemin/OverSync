import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  MAINTAINED_TS_WORKSPACES,
  parseTypecheckWorkspaces,
  validateAggregateTypecheck,
} from "./workspace-typecheck.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("aggregate workspace typecheck command", () => {
  it("defines a root typecheck script covering all maintained TypeScript workspaces in CI order", () => {
    const rootManifest = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const ciWorkflowText = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");

    const result = validateAggregateTypecheck({ rootManifest, ciWorkflowText });
    assert.equal(result.ok, true, `unexpected violations: ${result.violations.join("; ")}`);
    assert.deepEqual(result.workspaces, [...MAINTAINED_TS_WORKSPACES]);
  });

  it("rejects missing typecheck scripts or omitted maintained workspaces", () => {
    assert.equal(validateAggregateTypecheck({ rootManifest: { scripts: {} } }).ok, false);

    const partial = validateAggregateTypecheck({
      rootManifest: {
        scripts: {
          typecheck:
            "pnpm --filter @oversync/sdk exec tsc --noEmit && pnpm --filter @oversync/coordinator exec tsc --noEmit",
        },
      },
    });
    assert.equal(partial.ok, false);
    assert.ok(partial.violations.some((v) => v.includes("@oversync/resolver")));
    assert.ok(partial.violations.some((v) => v.includes("@oversync/frontend")));
    assert.ok(partial.violations.some((v) => v.includes("@oversync/relayer")));
  });

  it("parses workspace filters from chained pnpm --filter commands", () => {
    assert.deepEqual(
      parseTypecheckWorkspaces(
        "pnpm --filter @oversync/sdk exec tsc --noEmit && pnpm --filter @oversync/resolver exec tsc --noEmit",
      ),
      ["@oversync/sdk", "@oversync/resolver"],
    );
  });
});
