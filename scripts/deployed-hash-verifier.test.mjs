import test from "node:test";
import assert from "node:assert/strict";
import { compareDeployedHashes } from "./deployed-hash-verifier.mjs";

const manifest = {
  ethereum: { codeHashes: { HTLCEscrow: "0x" + "a".repeat(64) } },
  stellar: { codeHashes: { HTLC: "b".repeat(64) } }
};

test("accepts normalized EVM and Soroban code hashes", () => {
  const result = compareDeployedHashes(manifest, {
    ethereum: { HTLCEscrow: { codeHash: "0x" + "A".repeat(64) } },
    stellar: { HTLC: "0x" + "B".repeat(64) }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("reports missing and mismatched hashes without accepting partial evidence", () => {
  const result = compareDeployedHashes(manifest, { ethereum: { HTLCEscrow: "0x" + "c".repeat(64) } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches.map((item) => item.reason), ["hash_mismatch", "missing_observed_hash"]);
});

test("fails closed on malformed manifest hashes", () => {
  const result = compareDeployedHashes({ ethereum: { codeHashes: { HTLC: "not-a-hash" } } }, { ethereum: { HTLC: "0x" + "a".repeat(64) } });
  assert.equal(result.ok, false);
  assert.equal(result.mismatches[0].reason, "invalid_manifest_hash");
});
