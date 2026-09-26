#!/usr/bin/env node
/**
 * Verifies testnet asset identifiers stay aligned across the SDK (canonical),
 * frontend config/UI, and coordinator/resolver network defaults.
 *
 * Usage:   node scripts/check-testnet-assets.mjs
 * Or:      pnpm check:testnet-assets
 *
 * Exits non-zero with field-level mismatches when drift is detected.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_TESTNET,
  compareTestnetAssetSources,
} from "./lib/testnet-asset-consistency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath) {
  return readFileSync(resolve(ROOT, relPath), "utf8");
}

let failures = 0;
let passes = 0;

function pass(msg) {
  console.log(`  ok   ${msg}`);
  passes++;
}

function fail(msg) {
  console.error(`  FAIL ${msg}`);
  failures++;
}

function section(title, fn) {
  console.log(`\n${title}`);
  fn();
}

const stellarUsdcKey = `${CANONICAL_TESTNET.stellarUsdcCode}:${CANONICAL_TESTNET.stellarUsdcIssuer}`;

section("packages/sdk/src/assets/index.ts (canonical)", () => {
  const text = read("packages/sdk/src/assets/index.ts");
  for (const [label, value] of [
    ["native ETH", CANONICAL_TESTNET.nativeEth],
    ["Sepolia USDC", CANONICAL_TESTNET.sepoliaUsdc],
    ["Stellar USDC issuer", CANONICAL_TESTNET.stellarUsdcIssuer],
  ]) {
    const needle = label.includes("issuer") ? value : value.toLowerCase();
    const hay = label.includes("issuer") ? text : text.toLowerCase();
    if (hay.includes(needle)) pass(`${label} present in SDK`);
    else fail(`${label} missing from SDK assets/index.ts`);
  }
});

section("packages/sdk/src/assets/capabilities.ts", () => {
  const text = read("packages/sdk/src/assets/capabilities.ts");
  if (text.includes(CANONICAL_TESTNET.sepoliaUsdc)) pass("Sepolia USDC in capability matrix");
  else fail("Sepolia USDC missing from capability matrix");
  if (text.includes(stellarUsdcKey)) pass("Stellar USDC key in capability matrix");
  else fail("Stellar USDC key missing from capability matrix");
});

const result = compareTestnetAssetSources({
  networksTs: read("frontend/src/config/networks.ts"),
  tokenSelectorTs: read("frontend/src/components/TokenSelector.tsx"),
  coordinatorConfigTs: read("coordinator/src/config.ts"),
  resolverConfigTs: read("resolver/src/config.ts"),
  coordinatorPackageJson: read("coordinator/package.json"),
  resolverPackageJson: read("resolver/package.json"),
});

section("cross-package testnet asset alignment", () => {
  for (const check of result.checks) {
    if (check.ok) pass(check.label);
    else fail(check.detail ? `${check.label} — ${check.detail}` : check.label);
  }
});

console.log(`\n${passes} passed, ${failures} failed.`);

if (failures > 0) {
  console.error(
    "\nTestnet asset configuration drift detected.\n" +
      "Canonical mappings: packages/sdk/src/assets/index.ts\n" +
      "Update frontend/coordinator/resolver settings to match the SDK, then re-run pnpm check:testnet-assets."
  );
  process.exit(1);
}
