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

export function buildEvidenceData(): EvidenceData {
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
