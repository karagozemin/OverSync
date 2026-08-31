/**
 * Browser-side RPC endpoints for network health checks and wallet readiness.
 *
 * Set either the full URL (VITE_SEPOLIA_RPC_URL) or VITE_INFURA_API_KEY.
 * Infura keys in the frontend are visible in the bundle — that is normal for
 * wallet RPC endpoints; restrict the key by HTTP referrer in the Infura dashboard.
 */

const INFURA_SEPOLIA = 'https://sepolia.infura.io/v3';
const INFURA_MAINNET = 'https://mainnet.infura.io/v3';
const PUBLIC_SEPOLIA = 'https://ethereum-sepolia-rpc.publicnode.com';
const PUBLIC_MAINNET = 'https://ethereum-rpc.publicnode.com';

type ImportMetaEnv = ImportMeta & {
  env?: Record<string, string | undefined>;
};

function env(key: string): string | undefined {
  return (import.meta as ImportMetaEnv).env?.[key]?.trim() || undefined;
}

export function resolveViteSepoliaRpcUrl(): string {
  return (
    env('VITE_SEPOLIA_RPC_URL') ||
    (env('VITE_INFURA_API_KEY') ? `${INFURA_SEPOLIA}/${env('VITE_INFURA_API_KEY')}` : '') ||
    PUBLIC_SEPOLIA
  );
}

export function resolveViteMainnetRpcUrl(): string {
  return (
    env('VITE_MAINNET_RPC_URL') ||
    (env('VITE_INFURA_API_KEY') ? `${INFURA_MAINNET}/${env('VITE_INFURA_API_KEY')}` : '') ||
    PUBLIC_MAINNET
  );
}

// Explicit Stellar Horizon endpoints for wallet preflight checks
export const STELLAR_TESTNET_HORIZON_URLS = [
  'https://horizon-testnet.stellar.org',
  'https://soroban-testnet.stellar.org',
];

export const STELLAR_MAINNET_HORIZON_URLS = [
  'https://horizon.stellar.org',
  'https://soroban.stellar.org',
];
