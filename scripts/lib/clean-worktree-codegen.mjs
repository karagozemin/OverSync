import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Clean-worktree verification after running maintained generators (issue #399).
 *
 * Ensures maintained code/artifact generators leave zero tracked changes in the
 * worktree and that committed generated artifacts remain synchronized with
 * their canonical sources.
 */

export const TRACKED_GENERATED_ARTIFACTS = Object.freeze([
  "deployments.testnet.json",
  "packages/sdk/src/deployment-evidence/deployments.testnet.json",
  "contracts/v2-bytecode-hashes.json",
  "packages/sdk/src/ethereum/abi.ts",
]);

function sha256Normalized(content) {
  const normalized = String(content).replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Computes a deterministic SHA-256 snapshot of a list of tracked relative paths.
 */
export function snapshotTrackedFiles(repoRoot, relativePaths = TRACKED_GENERATED_ARTIFACTS) {
  const snapshot = new Map();
  for (const relPath of relativePaths) {
    const absPath = resolve(repoRoot, relPath);
    if (existsSync(absPath)) {
      snapshot.set(relPath, sha256Normalized(readFileSync(absPath, "utf8")));
    } else {
      snapshot.set(relPath, null);
    }
  }
  return snapshot;
}

/**
 * Compares two tracked-file snapshots (`before` and `after`) and returns any
 * paths that were modified, created, or deleted during code generation.
 */
export function diffTrackedSnapshots(beforeSnapshot, afterSnapshot) {
  const changes = [];
  const allKeys = new Set([...beforeSnapshot.keys(), ...afterSnapshot.keys()]);

  for (const path of [...allKeys].sort()) {
    const beforeHash = beforeSnapshot.get(path) ?? null;
    const afterHash = afterSnapshot.get(path) ?? null;
    if (beforeHash === afterHash) continue;

    if (beforeHash === null && afterHash !== null) {
      changes.push({ path, status: "added" });
    } else if (beforeHash !== null && afterHash === null) {
      changes.push({ path, status: "deleted" });
    } else {
      changes.push({ path, status: "modified" });
    }
  }

  return changes;
}

/**
 * Parses `git status --porcelain` output and returns tracked dirty entries.
 * Untracked (`??`) entries are ignored by default so the check focuses on
 * tracked worktree changes unless `includeUntracked: true` is passed.
 */
export function parseGitStatusPorcelain(porcelainOutput, options = {}) {
  const includeUntracked = Boolean(options.includeUntracked);
  const rawLines = String(porcelainOutput ?? "").split(/\r?\n/);
  const dirty = [];

  for (const line of rawLines) {
    if (!line || line.length < 4) continue;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;

    if (status === "??" && !includeUntracked) {
      continue;
    }

    const arrowIdx = rawPath.indexOf(" -> ");
    const cleanPath = arrowIdx >= 0 ? rawPath.slice(arrowIdx + 4).trim() : rawPath;
    dirty.push({
      status: status.trim() || status,
      path: cleanPath,
    });
  }

  return dirty;
}

/**
 * Verifies that committed generated artifacts (`packages/sdk/src/deployment-evidence/deployments.testnet.json`,
 * `contracts/v2-bytecode-hashes.json`, and `packages/sdk/src/ethereum/abi.ts`)
 * are present and in sync with canonical repository manifests.
 */
export function verifyGeneratedArtifactSync(repoRoot) {
  const stale = [];

  const canonicalPath = resolve(repoRoot, "deployments.testnet.json");
  const sdkEvidencePath = resolve(
    repoRoot,
    "packages/sdk/src/deployment-evidence/deployments.testnet.json",
  );

  if (!existsSync(canonicalPath)) {
    stale.push("deployments.testnet.json: missing canonical deployment manifest");
  } else if (!existsSync(sdkEvidencePath)) {
    stale.push(
      "packages/sdk/src/deployment-evidence/deployments.testnet.json: missing generated SDK deployment evidence",
    );
  } else {
    const canonical = JSON.parse(readFileSync(canonicalPath, "utf8"));
    const sdkEvidence = JSON.parse(readFileSync(sdkEvidencePath, "utf8"));
    const rows = Array.isArray(sdkEvidence.deployments) ? sdkEvidence.deployments : [];

    const expectedPairs = [
      {
        chain: "Ethereum",
        contractName: "HTLC",
        address: canonical?.ethereum?.contracts?.HTLCEscrow,
      },
      {
        chain: "Ethereum",
        contractName: "ResolverRegistry",
        address: canonical?.ethereum?.contracts?.ResolverRegistry,
      },
      {
        chain: "Stellar",
        contractName: "HTLC",
        address: canonical?.stellar?.contracts?.HTLC,
      },
      {
        chain: "Stellar",
        contractName: "ResolverRegistry",
        address: canonical?.stellar?.contracts?.ResolverRegistry,
      },
    ];

    for (const expected of expectedPairs) {
      const match = rows.find(
        (r) => r.chain === expected.chain && r.contractName === expected.contractName,
      );
      if (!match) {
        stale.push(
          `packages/sdk/src/deployment-evidence/deployments.testnet.json: missing ${expected.chain} ${expected.contractName} entry`,
        );
      } else if (match.address !== expected.address) {
        stale.push(
          `packages/sdk/src/deployment-evidence/deployments.testnet.json: stale ${expected.chain} ${expected.contractName} address "${match.address}" (expected "${expected.address}")`,
        );
      }
    }
  }

  const bytecodeHashesPath = resolve(repoRoot, "contracts/v2-bytecode-hashes.json");
  if (!existsSync(bytecodeHashesPath)) {
    stale.push("contracts/v2-bytecode-hashes.json: missing generated v2 bytecode hash file");
  } else {
    const hashes = JSON.parse(readFileSync(bytecodeHashesPath, "utf8"));
    for (const contractName of ["HTLCEscrow", "ResolverRegistry"]) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(hashes[contractName] ?? ""))) {
        stale.push(
          `contracts/v2-bytecode-hashes.json: invalid or stale bytecode hash for ${contractName}`,
        );
      }
    }
  }

  return {
    ok: stale.length === 0,
    stale,
  };
}

/**
 * Runs optional generator commands and verifies that the worktree has zero
 * tracked modifications afterward.
 */
export function runCleanWorktreeCheck({
  repoRoot,
  trackedPaths = TRACKED_GENERATED_ARTIFACTS,
  commands = [],
  porcelainOutput = null,
}) {
  const before = snapshotTrackedFiles(repoRoot, trackedPaths);
  const commandFailures = [];

  for (const cmd of commands) {
    const res = spawnSync(cmd.command, cmd.args ?? [], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (res.status !== 0) {
      commandFailures.push(
        `generator "${cmd.label ?? cmd.command}" exited with status ${res.status ?? 1}: ${(res.stderr || res.stdout || "").trim()}`,
      );
    }
  }

  const after = snapshotTrackedFiles(repoRoot, trackedPaths);
  const snapshotChanges = diffTrackedSnapshots(before, after);
  const syncResult = verifyGeneratedArtifactSync(repoRoot);

  let effectivePorcelain = porcelainOutput;
  if (effectivePorcelain === null && existsSync(resolve(repoRoot, ".git"))) {
    const gitRun = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (gitRun.status === 0) {
      effectivePorcelain = gitRun.stdout;
    }
  }

  const gitDirty =
    effectivePorcelain !== null ? parseGitStatusPorcelain(effectivePorcelain) : [];

  const dirtyPaths = new Map();
  for (const item of snapshotChanges) {
    dirtyPaths.set(item.path, item.status);
  }
  for (const item of gitDirty) {
    if (!dirtyPaths.has(item.path)) {
      dirtyPaths.set(item.path, item.status);
    }
  }

  const dirty = [...dirtyPaths.entries()].map(([path, status]) => ({ path, status }));
  const violations = [
    ...commandFailures,
    ...syncResult.stale,
    ...dirty.map(
      (d) => `tracked file "${d.path}" has uncommitted changes after codegen (${d.status})`,
    ),
  ];

  return {
    ok: violations.length === 0,
    trackedCount: trackedPaths.length,
    dirty,
    stale: syncResult.stale,
    violations,
  };
}
