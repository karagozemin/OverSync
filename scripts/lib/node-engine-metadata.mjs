import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Validates that `.nvmrc`, CI's `actions/setup-node` version, and `engines.node`
 * across the root and all workspace `package.json` manifests are aligned to the
 * reviewed Node 22 toolchain (`>=22.0.0`) (issue #395).
 */

export const EXPECTED_NODE_MAJOR = "22";
export const EXPECTED_NODE_ENGINE_RANGE = ">=22.0.0";

export function parseNvmrcMajor(nvmrcText) {
  const clean = String(nvmrcText ?? "").trim().replace(/^v/, "");
  const match = clean.match(/^(\d+)(?:\.\d+\.\d+)?$/);
  if (!match) {
    return {
      major: null,
      error: `.nvmrc "${clean}" must specify a valid Node major or X.Y.Z version`,
    };
  }
  return { major: match[1], error: null };
}

export function loadNodeEngineManifests(repoRoot) {
  const rootJson = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  );
  const dirs = (rootJson.workspaces ?? []).flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(join(repoRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  });

  const manifests = [{ path: "package.json", manifest: rootJson }];
  for (const dir of dirs) {
    const abs = join(repoRoot, dir, "package.json");
    if (!existsSync(abs)) continue;
    manifests.push({
      path: `${dir}/package.json`,
      manifest: JSON.parse(readFileSync(abs, "utf8")),
    });
  }
  return manifests;
}

export function validateNodeEngineMetadata({
  manifests,
  nvmrcText,
  ciWorkflowText = null,
}) {
  const violations = [];
  const parsedNvmrc = parseNvmrcMajor(nvmrcText);
  if (parsedNvmrc.error) {
    violations.push(parsedNvmrc.error);
  } else if (parsedNvmrc.major !== EXPECTED_NODE_MAJOR) {
    violations.push(
      `.nvmrc Node major "${parsedNvmrc.major}" must match CI Node major "${EXPECTED_NODE_MAJOR}"`,
    );
  }

  const expectedRange = `>=${parsedNvmrc.major ?? EXPECTED_NODE_MAJOR}.0.0`;

  for (const entry of manifests ?? []) {
    const actual = entry?.manifest?.engines?.node;
    if (!actual) {
      violations.push(`${entry.path} is missing engines.node`);
    } else if (actual !== expectedRange) {
      violations.push(
        `${entry.path} engines.node "${actual}" must be "${expectedRange}"`,
      );
    }
  }

  if (ciWorkflowText) {
    const matches = [
      ...String(ciWorkflowText).matchAll(/node-version:\s*['"]?(\d+)['"]?/g),
    ];
    for (const m of matches) {
      if (m[1] !== EXPECTED_NODE_MAJOR) {
        violations.push(
          `ci.yml node-version "${m[1]}" disagrees with expected Node major "${EXPECTED_NODE_MAJOR}"`,
        );
      }
    }
  }

  return {
    ok: violations.length === 0,
    expectedRange,
    violations,
  };
}
