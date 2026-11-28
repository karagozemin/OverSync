import { getCurrentNetwork } from '../config/networks';

export interface TestCoverageEntry {
  layer: string;
  testCount: number;
  framework: string;
}

export interface EvidenceContractEntry {
  name: string;
  chain: string;
  address: string;
  explorerUrl: string;
}

export interface EvidenceData {
  appMode: string;
  networkMode: string;
  contracts: EvidenceContractEntry[];
  frontendUrl: string | null;
  testnetContractCount: number;
  testCoverage: TestCoverageEntry[] | null;
  generatedAt: string;
  repoUrl: string;
  /**
   * Public order evidence, built from the coordinator's public field set.
   * Never contains a preimage, hashlock or resolver.
   */
  orders: PublicOrderEvidence[];
}

/**
 * The coordinator's public order field set.
 *
 * This mirrors `buildSnapshot()` in
 * `coordinator/src/persistence/orders-repo.ts`, which is the coordinator's
 * public redactor: it exposes only the order id, status, transition list,
 * public transaction hashes, timestamps, direction and an outcome summary.
 * It deliberately never exposes the HTLC preimage, hashlock, resolver or any
 * other secret material.
 *
 * Evidence exports must be produced from this same field set so a downloaded
 * file can never contain a field the public API hides.
 */
export interface PublicOrderEvidence {
  orderId: string;
  status: string;
  txHashes: string[];
  direction: string | null;
  transitions: string[];
  timestamps: {
    createdAt: number | null;
    updatedAt: number | null;
  };
  outcomeSummary: string | null;
}

/** Field names that must never appear in an exported order object. */
const FORBIDDEN_ORDER_FIELDS = ['preimage', 'hashlock', 'resolver', 'resolverAddress'];

/**
 * Build the public evidence view of a single order.
 *
 * Accepts either a coordinator order (as serialised by
 * `coordinator/src/server/routes/orders.ts`) or a coordinator snapshot (as
 * produced by `buildSnapshot()`), and returns only the public field set.
 *
 * A local order object that still carries a preimage (or any other secret
 * field) is *refused* rather than silently stripped: the browser must not be
 * the only thing standing between a secret and a downloaded evidence file.
 */
export function buildPublicOrderEvidence(order: unknown): PublicOrderEvidence {
  if (!order || typeof order !== 'object') {
    throw new Error('evidence export: order must be an object');
  }

  const raw = order as Record<string, any>;

  // Refuse — do not strip — any object that still carries secret material.
  for (const field of FORBIDDEN_ORDER_FIELDS) {
    if (field in raw && raw[field] !== undefined && raw[field] !== null) {
      throw new Error(
        `evidence export: refusing to export order with non-public field "${field}"`,
      );
    }
  }
  if (raw.secret && typeof raw.secret === 'object') {
    for (const field of FORBIDDEN_ORDER_FIELDS) {
      if (raw.secret[field] !== undefined && raw.secret[field] !== null) {
        throw new Error(
          `evidence export: refusing to export order with non-public field "secret.${field}"`,
        );
      }
    }
  }

  const orderId = raw.orderId ?? raw.id ?? raw.publicId;
  if (typeof orderId !== 'string' || orderId.length === 0) {
    throw new Error('evidence export: order is missing a public id');
  }

  const status = raw.currentState ?? raw.status;
  if (typeof status !== 'string' || status.length === 0) {
    throw new Error('evidence export: order is missing a status');
  }

  const txHashes = collectPublicTxHashes(raw);

  // Snapshot-shaped orders nest the timestamps; serialised order rows put
  // them at the top level. Accept both public shapes.
  const timestamps = raw.timestamps ?? {};
  const createdAt =
    typeof timestamps.createdAt === 'number'
      ? timestamps.createdAt
      : typeof raw.createdAt === 'number'
        ? raw.createdAt
        : null;
  const updatedAt =
    typeof timestamps.updatedAt === 'number'
      ? timestamps.updatedAt
      : typeof raw.updatedAt === 'number'
        ? raw.updatedAt
        : null;

  return {
    orderId,
    status,
    txHashes,
    direction: typeof raw.direction === 'string' ? raw.direction : null,
    transitions: Array.isArray(raw.transitions) ? [...raw.transitions] : [],
    timestamps: { createdAt, updatedAt },
    outcomeSummary: typeof raw.outcomeSummary === 'string' ? raw.outcomeSummary : null,
  };
}

function collectPublicTxHashes(raw: Record<string, any>): string[] {
  if (Array.isArray(raw.publicTxHashes)) {
    return raw.publicTxHashes.filter((tx: unknown): tx is string => typeof tx === 'string');
  }

  const hashes: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) hashes.push(value);
  };

  push(raw.src?.lockTx);
  push(raw.dst?.lockTx);
  push(raw.secret?.revealedTx);

  return hashes;
}

const TEST_COVERAGE_FIXTURE: TestCoverageEntry[] = [
  { layer: 'Soroban HTLC', testCount: 10, framework: 'Rust #[contracttest]' },
  { layer: 'Soroban ResolverRegistry', testCount: 6, framework: 'Rust #[contracttest]' },
  { layer: 'EVM HTLCEscrow', testCount: 15, framework: 'Hardhat + Chai' },
  { layer: 'EVM ResolverRegistry', testCount: 6, framework: 'Hardhat + Chai' },
  { layer: 'SDK', testCount: 8, framework: 'Vitest' },
  { layer: 'Coordinator', testCount: 4, framework: 'Vitest' },
];

function readFrontendUrl(): string | null {
  const url = (import.meta as any).env?.VITE_FRONTEND_URL;
  if (url && typeof url === 'string' && url.trim().length > 0) {
    return url.trim();
  }
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    if (origin && origin !== 'http://localhost:5173' && origin !== 'http://localhost:3000') {
      return origin;
    }
  }
  return null;
}

function readNetworkMode(): string {
  try {
    const current = getCurrentNetwork();
    const isTestnet = current.ethereum.testnet;
    return isTestnet ? 'testnet' : 'mainnet';
  } catch {
    return 'testnet';
  }
}

const V2_CONTRACTS: EvidenceContractEntry[] = [
  {
    name: 'HTLCEscrow',
    chain: 'Ethereum (Sepolia)',
    address: '0xb352339BEb146f2699d28D736700B953988bB178',
    explorerUrl: 'https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178',
  },
  {
    name: 'ResolverRegistry',
    chain: 'Ethereum (Sepolia)',
    address: '0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99',
    explorerUrl: 'https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99',
  },
  {
    name: 'oversync-htlc',
    chain: 'Stellar (testnet)',
    address: 'CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK',
    explorerUrl: 'https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK',
  },
  {
    name: 'oversync-resolver-registry',
    chain: 'Stellar (testnet)',
    address: 'CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF',
    explorerUrl: 'https://stellar.expert/explorer/testnet/contract/CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF',
  },
];

export function buildEvidenceData(orders: unknown[] = []): EvidenceData {
  const networkMode = readNetworkMode();
  const frontendUrl = readFrontendUrl();

  return {
    appMode: networkMode === 'mainnet' ? 'mainnet' : 'testnet-only',
    networkMode,
    contracts: V2_CONTRACTS,
    frontendUrl,
    testnetContractCount: V2_CONTRACTS.length,
    testCoverage: TEST_COVERAGE_FIXTURE,
    generatedAt: new Date().toISOString(),
    repoUrl: 'https://github.com/karagozemin/OverSync',
    orders: orders.map(buildPublicOrderEvidence),
  };
}

export function downloadEvidenceJson(data: EvidenceData, filename?: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `oversync-evidence-${data.networkMode}-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
