import { readFile } from "node:fs/promises";

const CODE_HASH = /^(?:0x)?[a-fA-F0-9]{64}$/;

function normalizeHash(value) {
  const raw = typeof value === "string" ? value : value?.codeHash;
  if (typeof raw !== "string" || !CODE_HASH.test(raw)) return null;
  return raw.replace(/^0x/, "").toLowerCase();
}

function expectedHashes(manifest) {
  return {
    ethereum: manifest?.ethereum?.codeHashes ?? {},
    stellar: manifest?.stellar?.codeHashes ?? {}
  };
}

/**
 * Compare operator-collected runtime bytecode hashes with deployment
 * evidence. The function is pure so CI and deployment tooling can use the
 * same fail-closed comparison without making RPC calls from this repository.
 */
export function compareDeployedHashes(manifest, observed) {
  const mismatches = [];
  const expected = expectedHashes(manifest);
  for (const chain of ["ethereum", "stellar"]) {
    for (const [contract, expectedValue] of Object.entries(expected[chain])) {
      const wanted = normalizeHash(expectedValue);
      const actual = normalizeHash(observed?.[chain]?.[contract]);
      const path = `${chain}.codeHashes.${contract}`;
      if (!wanted) {
        mismatches.push({ chain, contract, path, reason: "invalid_manifest_hash" });
      } else if (!actual) {
        mismatches.push({ chain, contract, path, reason: "missing_observed_hash", expected: wanted });
      } else if (wanted !== actual) {
        mismatches.push({ chain, contract, path, reason: "hash_mismatch", expected: wanted, observed: actual });
      }
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function main() {
  const manifestPath = argument("--manifest");
  const observedPath = argument("--observed");
  if (!manifestPath || !observedPath) {
    console.error("Usage: node scripts/verify-deployed-hashes.mjs --manifest <deployment.json> --observed <hashes.json>");
    process.exitCode = 2;
    return;
  }
  const result = compareDeployedHashes(await readJson(manifestPath), await readJson(observedPath));
  if (!result.ok) {
    console.error("Deployed code hash verification failed:");
    for (const mismatch of result.mismatches) console.error(`- ${mismatch.path}: ${mismatch.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log("Deployed code hashes match deployment manifest.");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
