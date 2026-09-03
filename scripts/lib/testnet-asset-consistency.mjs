/**
 * Shared logic for testnet asset configuration consistency checks.
 * Canonical values must stay aligned with packages/sdk/src/assets/index.ts.
 */

export const CANONICAL_TESTNET = Object.freeze({
  nativeEth: "0x0000000000000000000000000000000000000000",
  sepoliaUsdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  stellarUsdcCode: "USDC",
  stellarUsdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  stellarNetworkPassphrase: "Test SDF Network ; September 2015",
  ethereumTestnetChainId: 11155111,
});

export function canonicalStellarUsdcKey() {
  const { stellarUsdcCode, stellarUsdcIssuer } = CANONICAL_TESTNET;
  return `${stellarUsdcCode}:${stellarUsdcIssuer}`;
}

const RE_SEPOLIA_TEST_TOKEN = new RegExp(
  "CONTRACT_ADDRESSES[\\s\\S]*?ethereum:\\s*\\{[\\s\\S]*?sepolia:\\s*\\{[\\s\\S]*?testToken:\\s*['\"]([^'\"]+)['\"]"
);
const RE_STELLAR_TESTNET_PASSPHRASE = new RegExp(
  "testnet:\\s*\\{[\\s\\S]*?networkPassphrase:\\s*['\"]([^'\"]+)['\"]"
);
const RE_TOKEN_SELECTOR_ETH_USDC = new RegExp(
  "symbol:\\s*'USDC'[\\s\\S]*?chain:\\s*'ethereum'[\\s\\S]*?address:\\s*['\"]([^'\"]+)['\"]"
);
const RE_TOKEN_SELECTOR_STELLAR_USDC = new RegExp(
  "address:\\s*'USDC-([A-Z0-9]{56})'"
);

function normalizeEthAddress(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  // Exactly 40 hex digits — a 39- or 41-digit "address" is malformed and
  // must never be treated as a match.
  if (!/^0x[0-9a-f]{40}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * @param {{ canonical?: typeof CANONICAL_TESTNET, networksTs?: string, tokenSelectorTs?: string, coordinatorConfigTs?: string, resolverConfigTs?: string, coordinatorPackageJson?: string, resolverPackageJson?: string }} inputs
 * @returns {{ mismatches: string[], checks: { label: string, ok: boolean, detail?: string }[] }}
 */
export function compareTestnetAssetSources(inputs) {
  const canonical = inputs.canonical ?? CANONICAL_TESTNET;
  const mismatches = [];
  const checks = [];

  function expectMatch(label, actual, expected) {
    const ok = actual === expected;
    checks.push({
      label,
      ok,
      detail: ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    });
    if (!ok) {
      mismatches.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return ok;
  }

  if (inputs.networksTs != null) {
    const sepoliaTestToken = inputs.networksTs.match(RE_SEPOLIA_TEST_TOKEN)?.[1];
    const stellarPassphrase = inputs.networksTs.match(RE_STELLAR_TESTNET_PASSPHRASE)?.[1];

    expectMatch(
      "frontend/networks.ts sepolia.testToken",
      normalizeEthAddress(sepoliaTestToken ?? ""),
      canonical.sepoliaUsdc
    );
    expectMatch(
      "frontend/networks.ts stellar.testnet.networkPassphrase",
      stellarPassphrase ?? "",
      canonical.stellarNetworkPassphrase
    );
  }

  if (inputs.tokenSelectorTs != null) {
    const ethUsdc = inputs.tokenSelectorTs.match(RE_TOKEN_SELECTOR_ETH_USDC)?.[1];
    const stellarUsdcIssuer = inputs.tokenSelectorTs.match(RE_TOKEN_SELECTOR_STELLAR_USDC)?.[1];

    expectMatch(
      "frontend/TokenSelector.tsx ethereum USDC address",
      normalizeEthAddress(ethUsdc ?? ""),
      canonical.sepoliaUsdc
    );
    expectMatch(
      "frontend/TokenSelector.tsx stellar USDC issuer",
      stellarUsdcIssuer ?? "",
      canonical.stellarUsdcIssuer
    );
  }

  for (const [service, text] of [
    ["coordinator", inputs.coordinatorConfigTs],
    ["resolver", inputs.resolverConfigTs],
  ]) {
    if (text == null) continue;
    const hasTestnetDefault =
      text.includes('process.env.NETWORK_MODE ?? "testnet"') ||
      text.includes('(process.env.NETWORK_MODE ?? "testnet")');
    expectMatch(`${service}/config.ts default NETWORK_MODE testnet`, hasTestnetDefault, true);

    const hasSepoliaChainId = text.includes("11_155_111") || text.includes("11155111");
    expectMatch(`${service}/config.ts ethereum testnet chainId`, hasSepoliaChainId, true);

    expectMatch(
      `${service}/config.ts stellar testnet passphrase`,
      text.includes(canonical.stellarNetworkPassphrase),
      true
    );
  }

  for (const [service, pkgJson] of [
    ["coordinator", inputs.coordinatorPackageJson],
    ["resolver", inputs.resolverPackageJson],
  ]) {
    if (pkgJson == null) continue;
    let parsed;
    try {
      parsed = JSON.parse(pkgJson);
    } catch {
      mismatches.push(`${service}/package.json: invalid JSON`);
      checks.push({ label: `${service}/package.json parse`, ok: false });
      continue;
    }
    const dep = parsed.dependencies?.["@oversync/sdk"];
    const ok = dep != null && dep.length > 0;
    checks.push({
      label: `${service}/package.json @oversync/sdk dependency`,
      ok,
      detail: ok ? undefined : "missing @oversync/sdk dependency",
    });
    if (!ok) {
      mismatches.push(`${service}/package.json: missing @oversync/sdk dependency (asset mappings live in SDK)`);
    }
  }

  return { mismatches, checks };
}
