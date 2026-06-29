#!/usr/bin/env node
/**
 * Verifies that testnet contract addresses documented in README.md and
 * ROADMAP.md match the canonical deployments.testnet.json, and that
 * backend configs reference the correct env-var names.
 *
 * Usage:   node scripts/verify-addresses.mjs
 * Or:      pnpm verify:addresses
 *
 * Exits non-zero when any check fails. See docs/DEPLOYMENT.md §
 * "Updating addresses after redeployment" for the update workflow.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── Canonical source ─────────────────────────────────────────────────────────

const deployments = JSON.parse(
  readFileSync(resolve(ROOT, 'deployments.testnet.json'), 'utf8')
);

const EVM     = deployments.ethereum.contracts;
const STELLAR = deployments.stellar.contracts;

const ADDRESSES = [
  { name: 'HTLCEscrow (Sepolia)',                  chain: 'evm',     value: EVM.HTLCEscrow },
  { name: 'ResolverRegistry (Sepolia)',             chain: 'evm',     value: EVM.ResolverRegistry },
  { name: 'oversync-htlc (Stellar testnet)',        chain: 'stellar', value: STELLAR.HTLC },
  { name: 'oversync-resolver-registry (Stellar)',  chain: 'stellar', value: STELLAR.ResolverRegistry },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if `text` contains a full or recognisable abbreviated form of
 * the address.  Abbreviated forms like "0xb352339B…bB178" and
 * "CDIKSJK…6JK" are matched by testing whether the canonical prefix appears
 * verbatim in the file.
 *
 * Prefix lengths chosen so no two canonical addresses share a common prefix
 * and the shortest abbreviated form seen in the docs still matches:
 *   EVM    — "0x" + 8 hex = 10 chars (ROADMAP abbreviates to "0xb352339B…")
 *   Stellar — 7 chars        (ROADMAP abbreviates to "CDIKSJK…")
 */
function containsAddress(text, { chain, value }) {
  if (text.toLowerCase().includes(value.toLowerCase())) return true;
  const prefix = chain === 'evm' ? value.slice(0, 10) : value.slice(0, 7);
  return text.includes(prefix);
}

let failures = 0;
let passes   = 0;

function pass(msg) { console.log(`  ok   ${msg}`); passes++; }
function fail(msg) { console.error(`  FAIL ${msg}`); failures++; }

function section(title, fn) { console.log(`\n${title}`); fn(); }

// ── 1. Docs: README and ROADMAP ───────────────────────────────────────────────

section('README.md', () => {
  const text = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
  for (const addr of ADDRESSES) {
    if (containsAddress(text, addr)) pass(addr.name);
    else fail(`${addr.name}: "${addr.value}" not found (full or prefix)`);
  }
});

section('ROADMAP.md', () => {
  const text = readFileSync(resolve(ROOT, 'ROADMAP.md'), 'utf8');
  for (const addr of ADDRESSES) {
    if (containsAddress(text, addr)) pass(addr.name);
    else fail(`${addr.name}: "${addr.value}" not found (full or prefix)`);
  }
});

// ── 2. env.example — correct env-var names present, stale names absent ───────

section('env.example', () => {
  const text = readFileSync(resolve(ROOT, 'env.example'), 'utf8');

  // These must exist so operators can populate the right variables.
  const required = [
    'ETH_HTLC_ESCROW_TESTNET',
    'ETH_HTLC_ESCROW_MAINNET',
    'ETH_RESOLVER_REGISTRY_TESTNET',
    'SOROBAN_HTLC_TESTNET',
    'SOROBAN_RESOLVER_REGISTRY_TESTNET',
    'VITE_ETH_HTLC_ESCROW_TESTNET',
  ];
  for (const name of required) {
    if (text.includes(name)) pass(`env var '${name}' present`);
    else fail(`env var '${name}' missing — add it so operators know what to set`);
  }

  // These are the pre-v2 names; having them alongside the correct names is
  // confusing and caused real misconfiguration.
  const stale = ['ETH_HTLC_FACTORY_TESTNET', 'ETH_HTLC_FACTORY_MAINNET'];
  for (const name of stale) {
    if (!text.includes(name)) pass(`stale var '${name}' not present`);
    else fail(`stale env var '${name}' found — rename to ETH_HTLC_ESCROW_* to match v2 configs`);
  }
});

// ── 3. Backend configs reference the correct env-var names ───────────────────

for (const file of ['resolver/src/config.ts', 'coordinator/src/config.ts']) {
  section(file, () => {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    for (const varName of [
      'ETH_HTLC_ESCROW_TESTNET',
      'SOROBAN_HTLC_TESTNET',
    ]) {
      if (text.includes(varName)) pass(varName);
      else fail(`missing reference to env var '${varName}'`);
    }
  });
}

// ── 4. Frontend reads v2 address from the correct VITE_ env var ──────────────

section('frontend/src/lib/sdk-context.ts', () => {
  const text = readFileSync(resolve(ROOT, 'frontend/src/lib/sdk-context.ts'), 'utf8');
  if (text.includes('VITE_ETH_HTLC_ESCROW_TESTNET')) pass('VITE_ETH_HTLC_ESCROW_TESTNET');
  else fail('missing reference to VITE_ETH_HTLC_ESCROW_TESTNET');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passes} passed, ${failures} failed.`);

if (failures > 0) {
  console.error(
    '\nAddress drift detected.\n' +
    'See docs/DEPLOYMENT.md § "Updating addresses after redeployment" for the fix workflow.'
  );
  process.exit(1);
}
