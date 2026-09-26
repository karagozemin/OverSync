#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const SRC_DIRS = [
  { dir: 'coordinator/src', pkg: '@oversync/coordinator' },
  { dir: 'coordinator/test', pkg: '@oversync/coordinator' },
  { dir: 'relayer/src', pkg: '@oversync/relayer' },
  { dir: 'resolver/src', pkg: '@oversync/resolver' },
  { dir: 'resolver/test', pkg: '@oversync/resolver' },
  { dir: 'stellar/src', pkg: '@oversync/stellar' },
  { dir: 'frontend/src', pkg: '@oversync/frontend' },
  { dir: 'frontend/vite.config.ts', pkg: '@oversync/frontend' },
  { dir: 'e2e', pkg: '@oversync/e2e' },
  { dir: 'packages/sdk/src', pkg: '@oversync/sdk' },
  { dir: 'contracts/scripts', pkg: '@oversync/contracts' },
  { dir: 'contracts/hardhat.config.ts', pkg: '@oversync/contracts' },
  { dir: 'scripts', pkg: 'root' },
];

const ENV_EXAMPLE_FILES = [
  { path: 'env.example', pkg: 'root' },
];

const FILE_EXTS = new Set(['.ts', '.js', '.mjs', '.tsx']);

const ALLOWLIST = {
  'npm_package_version': 'npm runtime-injected, not user-configurable',
  'GIT_COMMIT': 'CI-injected at build time',
  'COMMIT_SHA': 'CI-injected at build time',
  'SOURCE_VERSION': 'Heroku/CI-injected at build time',
  'DEV': 'Vite built-in, not user-configurable',
  'PROD': 'Vite built-in, not user-configurable',
  'MODE': 'Vite built-in, not user-configurable',
  'BASE_URL': 'Vite built-in, not user-configurable',
  'SSR': 'Vite built-in, not user-configurable',
  'SCF_METRICS_TIMEOUT_MS': 'Script-specific metrics var',
  'SCF_COORDINATOR_URL': 'Script-specific metrics var',
  'LOAD_TEST_ORDERS': 'E2E load-test only',
  'LOAD_TEST_CONCURRENCY': 'E2E load-test only',
  'LOAD_TEST_RATE_PER_SEC': 'E2E load-test only',
  'LOAD_TEST_TIMELOCK_SEC': 'E2E load-test only',
  'LOAD_TEST_LIVE': 'E2E load-test only',
  'LOAD_TEST_ALLOW_LARGE': 'E2E load-test only',
  'LOAD_TEST_SEED': 'E2E load-test only',
  'LOAD_TEST_OUTPUT_DIR': 'E2E load-test only',
  'TEST_ETHEREUM_PRIVATE_KEY': 'Test helper, not production config',
  'TEST_ETHEREUM_ADDRESS': 'Test helper, not production config',
  'TEST_STELLAR_SECRET_KEY': 'Test helper, not production config',
  'TEST_STELLAR_PUBLIC_KEY': 'Test helper, not production config',
  'SLACK_WEBHOOK_URL': 'Test alerting only',
  'DISCORD_WEBHOOK_URL': 'Test alerting only',
  'ALERT_EMAIL': 'Test alerting only',
  'PRIVATE_KEY': 'Generic hardhat fallback, not app-specific',
  'REPORT_GAS': 'Hardhat gas reporter toggle',
  'RELAYER_ETH_ADDRESS': 'Legacy deploy helper, superseded by key derivation',
  'V2_STAKE_ASSET': 'Contract deployment param, not runtime config',
  'V2_MIN_STAKE': 'Contract deployment param, not runtime config',
  'V2_MIN_SAFETY_DEPOSIT': 'Contract deployment param, not runtime config',
  'RELAYER_PORT': 'Legacy alias for COORDINATOR_PORT',
  'PORT': 'Generic PaaS fallback port',
  'VITE_ENABLE_TESTNET_FAUCETS': 'Type-declared but never read',
  'VITE_ENABLE_DEBUG_MODE': 'Type-declared but never read',
  'VITE_ETHEREUM_CHAIN_ID': 'Type-declared but never read',
  'VITE_STELLAR_NETWORK': 'Type-declared but never read',
  'VITE_ETHEREUM_RPC_URL': 'Type-declared but never read',
  'VITE_STELLAR_HORIZON_URL': 'Type-declared but never read',
  'ONEINCH_ESCROW_FACTORY_MAINNET': 'Documented but never directly read; from deployments JSON',
  'ALCHEMY_API_KEY': 'Reserved for future integration',
  'COORDINATOR_RPC_TIMEOUT_MS': 'Reserved for future use',
  'VITE_NETWORK_MODE': 'Superseded by VITE_NETWORK',
  'ETHEREUM_RPC_URL': 'Legacy alias, superseeded by SEPOLIA_RPC_URL/MAINNET_RPC_URL',
  'RELAYER_STELLAR_SECRET_MAINNET': 'Network-specific fallback for RELAYER_STELLAR_SECRET',
  'RELAYER_STELLAR_SECRET_TESTNET': 'Network-specific fallback for RELAYER_STELLAR_SECRET',
  'ETHEREUM_ESCROW_FACTORY': 'Legacy relayer escrow, superseded by ETH_HTLC_ESCROW_*',
  'SEPOLIA_ESCROW_FACTORY': 'Legacy relayer escrow, superseded by ETH_HTLC_ESCROW_*',
  'RELAYER_POLL_INTERVAL': 'Legacy alias for RELAYER_ACTIVE_POLL_INTERVAL_MS',
  'CORS_ORIGIN': 'Coordinator CORS setting (stable)',
  'COORDINATOR_URL': 'Resolver peer address (stable)',
  'VITE_ENABLE_MOCK_DATA': 'Frontend dev helper',
  'VITE_NETWORK': 'Frontend network override',
  'VITE_APP_PORT': 'Vite dev server port',
  'VITE_APP_HOST': 'Vite dev server host',
  'RELAYER_RETRY_ATTEMPTS': 'Relayer retry config (internal)',
  'RELAYER_RETRY_DELAY': 'Relayer retry config (internal)',
  'ENABLE_MOCK_MODE': 'Relayer testing mode (internal)',
  'RELAYER_RESOLVER_ADDRESSES': 'Relayer internal config',
  'RELAYER_RPC_TIMEOUT_MS': 'Relayer internal config',
  'ETHEREUM_NETWORK': 'Relayer internal config',
  'GAS_PRICE_GWEI': 'Relayer internal config',
  'GAS_LIMIT': 'Relayer internal config',
  'START_BLOCK_ETHEREUM': 'Relayer internal config',
  'MIN_CONFIRMATION_BLOCKS': 'Relayer internal config',
  'STELLAR_NETWORK': 'Relayer internal config',
  'STELLAR_NETWORK_PASSPHRASE': 'Relayer internal config',
  'RELAYER_STELLAR_PUBLIC': 'Relayer internal config',
  'START_LEDGER_STELLAR': 'Relayer internal config',
  'STELLAR_MIN_CONFIRMATIONS': 'Relayer internal config',
  'RELAYER_FEE_RATE': 'Relayer internal config',
  'MIN_SWAP_AMOUNT_USD': 'Relayer internal config',
  'MAX_SWAP_AMOUNT_USD': 'Relayer internal config',
  'MAX_ORDER_AMOUNT': 'Relayer internal config',
  'MIN_TIMELOCK_DURATION': 'Relayer internal config',
  'MAX_TIMELOCK_DURATION': 'Relayer internal config',
  'DEFAULT_TIMELOCK_DURATION': 'Relayer internal config',
  'EMERGENCY_SHUTDOWN': 'Relayer internal config',
  'MAINTENANCE_MODE': 'Relayer internal config',
  'ENABLE_REQUEST_LOGGING': 'Relayer internal config',
  'VERBOSE_LOGGING': 'Relayer internal config',
  'HEALTH_CHECK_INTERVAL': 'Relayer internal config',
  'HEALTH_CHECK_TIMEOUT': 'Relayer internal config',
  'RESOLVER_POLL_INTERVAL_MS': 'Resolver internal config',
  'RELAYER_PRIVATE_KEY': 'Relayer secret key (superseded by coordinator)',
  'RELAYER_STELLAR_SECRET': 'Relayer stellar secret (superseded by coordinator)',
};

function walkDir(dirPath) {
  const files = [];
  if (!fs.existsSync(dirPath)) return files;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walkDir(full));
    } else if (FILE_EXTS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function collectFiles(entries) {
  const result = new Map();
  for (const entry of entries) {
    const dirPath = path.resolve(ROOT, entry.dir);
    let files;
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) {
      files = [dirPath];
    } else {
      files = walkDir(dirPath);
    }
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      result.set(rel, entry.pkg);
    }
  }
  return result;
}

function extractEnvVars(content) {
  const vars = new Set();

  const patterns = [
    /process\.env\.([A-Z_][A-Z0-9_]*)/g,
    /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
    /import\.meta\.env\?\.([A-Z_][A-Z0-9_]*)/g,
    /\(import\.meta\s+as\s+any\)\.env\?\.([A-Z_][A-Z0-9_]*)/g,
    /\(import\.meta\s+as\s+any\)\.env\.([A-Z_][A-Z0-9_]*)/g,
    /env\(['"]([A-Z_][A-Z0-9_]*)['"]\)/g,
    /env\.([A-Z_][A-Z0-9_]+)/g,
    /process\.env\[([^\]]+)\]/g,
  ];

  for (const re of patterns) {
    const matches = content.matchAll(re);
    for (const m of matches) {
      if (m.length > 1 && /^[A-Z_][A-Z0-9_]*$/.test(m[1])) {
        vars.add(m[1]);
      }
      if (m[0].startsWith('process.env[') && m[0].includes('"') || m[0].includes("'")) {
        const inner = m[1];
        const innerMatches = [...inner.matchAll(/['"]([A-Z_][A-Z0-9_]*)['"]/g)];
        for (const im of innerMatches) {
          vars.add(im[1]);
        }
      }
    }
  }

  return [...vars];
}

function parseEnvExample(filePath) {
  const vars = new Set();
  if (!fs.existsSync(filePath)) return vars;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    if (/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      vars.add(name);
    }
  }
  return vars;
}

function printReport(title, items, icon) {
  console.log(`\n--- ${title} ---\n`);
  if (items.length === 0) {
    console.log(`  ${icon} None found\n`);
    return;
  }
  for (const item of items) {
    console.log(`  ${icon} ${item}`);
  }
}

let exitCode = 0;

console.log('=== Env Docs Drift Check ===\n');

// 1. Parse env.example files
console.log('Env example files:');
const documented = new Map();
for (const entry of ENV_EXAMPLE_FILES) {
  const fp = path.resolve(ROOT, entry.path);
  const vars = parseEnvExample(fp);
  documented.set(entry.pkg, { file: entry.path, vars });
  console.log(`  ${entry.path} (${vars.size} vars)`);
}

// 2. Enumerate all source files
console.log('\nScanning source files...');
const allFiles = collectFiles(SRC_DIRS);
const fileCount = allFiles.size;

// 3. Extract env vars from each file
const discoveredByFile = new Map();
const discoveredAll = new Map();

for (const [relFile, pkg] of allFiles) {
  const content = fs.readFileSync(path.resolve(ROOT, relFile), 'utf-8');
  const vars = extractEnvVars(content);
  if (vars.length === 0) continue;
  discoveredByFile.set(relFile, { pkg, vars });
  for (const v of vars) {
    if (!discoveredAll.has(v)) discoveredAll.set(v, []);
    discoveredAll.get(v).push({ pkg, file: relFile });
  }
}

console.log(`  Scanned ${fileCount} files, found ${discoveredAll.size} unique env vars\n`);

// 4. Build documented set
const allDocumented = new Set();
for (const [, entry] of documented) {
  for (const v of entry.vars) allDocumented.add(v);
}
const allDiscoveredSet = new Set(discoveredAll.keys());

// 5. Missing vars (in source, not documented, not allowlisted)
const missing = [];
for (const [v, locations] of discoveredAll) {
  if (allDocumented.has(v)) continue;
  if (ALLOWLIST[v]) continue;
  missing.push({ var: v, locs: locations });
}

if (missing.length > 0) {
  for (const item of missing) {
    console.log(`\u274C ${item.var}`);
    const groups = new Map();
    for (const loc of item.locs) {
      if (!groups.has(loc.pkg)) groups.set(loc.pkg, []);
      groups.get(loc.pkg).push(loc.file);
    }
    for (const [pkg, files] of groups) {
      console.log(`     ${pkg}:`);
      for (const f of files.slice(0, 3)) {
        console.log(`       ${f}`);
      }
      if (files.length > 3) console.log(`       ... (${files.length - 3} more)`);
    }
    console.log('');
  }
  exitCode = 1;
} else {
  console.log('\u2713 All env vars in source are documented or allowlisted\n');
}

// 6. Unused docs (in env.example but never read)
const unused = [];
for (const [, entry] of documented) {
  for (const v of entry.vars) {
    if (!allDiscoveredSet.has(v)) {
      unused.push({ var: v, file: entry.file });
    }
  }
}

if (unused.length > 0) {
  console.log('--- Potentially unused docs (documented but not read in source) ---');
  for (const item of unused) {
    console.log(`  \u26A0  ${item.var}  (${item.file})`);
  }
  console.log('');
}

// 7. Allowlisted vars
const allowlisted = [];
for (const [v, locations] of discoveredAll) {
  if (allDocumented.has(v)) continue;
  if (!ALLOWLIST[v]) continue;
  allowlisted.push({ var: v, reason: ALLOWLIST[v], locs: locations });
}

if (allowlisted.length > 0) {
  console.log('--- Allowlisted vars (read in source, intentionally not in env.example) ---');
  for (const item of allowlisted) {
    const pkgSet = new Set(item.locs.map(l => l.pkg));
    const pkgs = [...pkgSet].join(', ');
    console.log(`  \u2139 ${item.var}  (${pkgs})`);
    console.log(`      ${item.reason}`);
  }
  console.log('');
}

// Summary
console.log('='.repeat(56));
console.log(`  Documented:   ${allDocumented.size}`);
console.log(`  Discovered:   ${allDiscoveredSet.size}`);
console.log(`  Missing:      ${missing.length}`);
console.log(`  Unused:       ${unused.length}`);
console.log(`  Allowlisted:  ${allowlisted.length}`);
console.log('='.repeat(56));

if (exitCode !== 0) {
  console.error(`\n\u2717 ${missing.length} env var(s) missing from env.example`);
} else {
  console.log(`\n\u2713 All env vars are documented or explicitly allowlisted`);
}

process.exit(exitCode);
