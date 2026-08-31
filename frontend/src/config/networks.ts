/**
 * Network Configuration for FusionBridge
 */

import { resolveViteMainnetRpcUrl, resolveViteSepoliaRpcUrl } from './rpc-urls';

export type AppNetworkMode = 'mainnet' | 'testnet';

/**
 * When false, the dApp is testnet-only. Mainnet toggle shows "Mainnet Coming".
 * Re-enable with VITE_MAINNET_ENABLED=true (post v2 audit / mainnet launch).
 */
export const isMainnetEnabled = (): boolean => {
  const raw = (import.meta as any).env?.VITE_MAINNET_ENABLED;
  return raw === 'true' || raw === true;
};

/** Clamp requested mode when mainnet is temporarily disabled. */
export const resolveNetworkMode = (requested: AppNetworkMode): AppNetworkMode => {
  if (requested === 'mainnet' && !isMainnetEnabled()) {
    return 'testnet';
  }
  return requested;
};

/**
 * Validates frontend environment variables at build time.
 * Throws descriptive errors for missing or misconfigured testnet/mainnet settings.
 */
export function validateFrontendEnv(): void {
  const env = (import.meta as any).env || {};
  const errors: string[] = [];
  const warnings: string[] = [];

  // Detect network mode
  const networkMode = env.VITE_NETWORK_MODE || env.VITE_NETWORK || 'testnet';
  const isMainnet = networkMode === 'mainnet';

  // Mainnet requires explicit audit confirmation
  if (isMainnet) {
    const mainnetEnabled = env.VITE_MAINNET_ENABLED === 'true';
    const auditConfirmed = env.VITE_MAINNET_AUDIT_CONFIRMED === 'true';

    if (!mainnetEnabled) {
      errors.push(
        "MAINNET BLOCKED: VITE_MAINNET_ENABLED must be 'true' to use mainnet. " +
        "Keep it 'false' until post-audit mainnet launch."
      );
    }

    if (!auditConfirmed) {
      errors.push(
        "MAINNET DEPLOYMENT BLOCKED: Set VITE_MAINNET_AUDIT_CONFIRMED=true only after " +
        "completing the mainnet readiness checklist in docs/DEPLOYMENT.md. " +
        "This includes audit completion, multisig ownership, and bug bounty."
      );
    }
  }

  // Validate testnet contract addresses
  if (!isMainnet) {
    const testnetContracts = {
      'VITE_ETH_HTLC_ESCROW_TESTNET': env.VITE_ETH_HTLC_ESCROW_TESTNET,
      'VITE_ETH_RESOLVER_REGISTRY_TESTNET': env.VITE_ETH_RESOLVER_REGISTRY_TESTNET,
    };

    const missingContracts = Object.entries(testnetContracts)
      .filter(([, value]) => !value || value.includes('YOUR_') || value.includes('0x000000'))
      .map(([key]) => key);

    if (missingContracts.length > 0) {
      errors.push(
        `TESTNET CONFIG INCOMPLETE: Missing or placeholder testnet contract addresses: ` +
        missingContracts.join(', ') +
        ". Deploy contracts first (see docs/DEPLOYMENT.md) or check env.example."
      );
    }
  }

  // Validate mainnet contract addresses if mainnet is enabled
  if (isMainnet && env.VITE_MAINNET_ENABLED === 'true') {
    const mainnetContracts = {
      'VITE_ETH_HTLC_ESCROW_MAINNET': env.VITE_ETH_HTLC_ESCROW_MAINNET,
      'VITE_ETH_RESOLVER_REGISTRY_MAINNET': env.VITE_ETH_RESOLVER_REGISTRY_MAINNET,
    };

    const missingContracts = Object.entries(mainnetContracts)
      .filter(([, value]) => !value || value.includes('YOUR_') || value.includes('0x000000'))
      .map(([key]) => key);

    if (missingContracts.length > 0) {
      errors.push(
        `MAINNET CONFIG INCOMPLETE: Missing or placeholder mainnet contract addresses: ` +
        missingContracts.join(', ') +
        ". Deploy mainnet contracts and set addresses in Vercel environment variables."
      );
    }
  }

  // Validate API base URL
  const apiBaseUrl = env.VITE_API_BASE_URL;
  if (!apiBaseUrl || apiBaseUrl.includes('YOUR_')) {
    warnings.push("VITE_API_BASE_URL not configured or using placeholder. Frontend will not be able to reach the coordinator API.");
  }

  // Validate RPC URLs
  const sepoliaRpcUrl = env.VITE_SEPOLIA_RPC_URL;
  const mainnetRpcUrl = env.VITE_MAINNET_RPC_URL;

  if (!isMainnet && (!sepoliaRpcUrl || sepoliaRpcUrl.includes('YOUR_'))) {
    warnings.push("VITE_SEPOLIA_RPC_URL not configured. Testnet users may experience connection issues.");
  }

  if (isMainnet && (!mainnetRpcUrl || mainnetRpcUrl.includes('YOUR_'))) {
    warnings.push("VITE_MAINNET_RPC_URL not configured. Mainnet users may experience connection issues.");
  }

  // Report errors (fail build)
  if (errors.length > 0) {
    console.error('❌ FRONTEND ENVIRONMENT VALIDATION FAILED:');
    errors.forEach(err => console.error(`   - ${err}`));
    console.error('\nFrontend build blocked. Fix the above errors and rebuild.');
    throw new Error(`Frontend environment validation failed:\n${errors.join('\n')}`);
  }

  // Report warnings (don't fail build)
  if (warnings.length > 0) {
    console.warn('⚠️  Frontend environment warnings:');
    warnings.forEach(warn => console.warn(`   - ${warn}`));
  }

  console.log('✅ Frontend environment validation passed');
}

// Run validation at module load time (build time for Vite)
validateFrontendEnv();

function readNetworkNameFromEnvOrUrl(): AppNetworkMode {
  let networkName: AppNetworkMode = 'testnet';

  if (typeof window !== 'undefined') {
    const urlNetwork = new URLSearchParams(window.location.search).get('network');
    if (urlNetwork === 'mainnet' || urlNetwork === 'testnet') {
      networkName = urlNetwork;
      return resolveNetworkMode(networkName);
    }
  }

  const envNetwork = (import.meta as any).env?.VITE_NETWORK;
  if (envNetwork === 'mainnet' || envNetwork === 'testnet') {
    networkName = envNetwork;
  }

  return resolveNetworkMode(networkName);
}

export interface NetworkConfig {
  id: number;
  name: string;
  displayName: string;
  rpcUrl: string;
  explorerUrl: string;
  escrowFactory?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  testnet: boolean;
}

export interface StellarNetworkConfig {
  name: string;
  displayName: string;
  horizonUrl: string;
  networkPassphrase: string;
  explorerUrl: string;
  testnet: boolean;
}

export const ETHEREUM_NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    id: 1,
    name: 'ethereum',
    displayName: 'Ethereum Mainnet',
    rpcUrl: resolveViteMainnetRpcUrl(),
    explorerUrl: 'https://etherscan.io',
    escrowFactory: '0xa7bCb4EAc8964306F9e3764f67Db6A7af6DdF99A', // 1inch Escrow Factory
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    testnet: false,
  },
  sepolia: {
    id: 11155111,
    name: 'sepolia',
    displayName: 'Sepolia Testnet',
    rpcUrl: resolveViteSepoliaRpcUrl(),
    explorerUrl: 'https://sepolia.etherscan.io',
    escrowFactory: '0x3f344ACDd17a0c4D21096da895152820f595dc8A', // Testnet HTLC Bridge
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'SEP',
      decimals: 18,
    },
    testnet: true,
  },
  hardhat: {
    id: 31337,
    name: 'hardhat',
    displayName: 'Hardhat Local',
    rpcUrl: 'http://127.0.0.1:8545',
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    testnet: true,
  },
};

export const STELLAR_NETWORKS: Record<string, StellarNetworkConfig> = {
  mainnet: {
    name: 'mainnet',
    displayName: 'Stellar Mainnet',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    explorerUrl: 'https://stellarchain.io',
    testnet: false,
  },
  testnet: {
    name: 'testnet',
    displayName: 'Stellar Testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    explorerUrl: 'https://testnet.stellarchain.io',
    testnet: true,
  },
};

export const CONTRACT_ADDRESSES = {
  ethereum: {
    mainnet: {
      htlcBridge: '0x0000000000000000000000000000000000000000', // Will use 1inch escrow instead
      escrowFactory: '0xa7bcb4eac8964306f9e3764f67db6a7af6ddf99a', // 1inch Escrow Factory
      testToken: '0xA0b86a33E6441b8bB770AE39aaDC4e75C0f03E6F', // WETH mainnet
    },
    sepolia: {
      htlcBridge: '0x3f344ACDd17a0c4D21096da895152820f595dc8A',
      escrowFactory: '0x6c3818E074d891F1FBB3A75913e4BDe87BcF1123',
      testToken: '0x677afcB4A57a938A74a1A76a93913dE4Db3e5C63',
    },
  },
  stellar: {
    mainnet: {
      // Stellar uses account addresses, not contract addresses
      // These should be actual funded accounts for mainnet operations
      bridgeAccount: 'GCKFBEIYTKP6RSTVVK6FKXKMK7DIS3R6SEWXO5SWH3V7GDPRX2VDKYXB', // Replace with actual mainnet bridge account
      escrowAccount: 'GCKFBEIYTKP6RSTVVK6FKXKMK7DIS3R6SEWXO5SWH3V7GDPRX2VDKYXB', // Replace with actual mainnet escrow account
    },
    testnet: {
      bridgeAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      escrowAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
  },
};

export const FAUCETS = {
  ethereum: {
    sepolia: [
      {
        name: 'Sepolia Faucet',
        url: 'https://sepoliafaucet.com/',
        description: 'Get Sepolia ETH for testing',
      },
      {
        name: 'Alchemy Faucet',
        url: 'https://sepoliafaucet.com/',
        description: 'Alchemy Sepolia ETH Faucet',
      },
    ],
  },
  stellar: {
    testnet: [
      {
        name: 'Stellar Testnet Faucet',
        url: 'https://laboratory.stellar.org/#account-creator',
        description: 'Create and fund testnet accounts',
      },
      {
        name: 'Stellar Quest Faucet',
        url: 'https://quest.stellar.org/faucet',
        description: 'Get testnet XLM',
      },
    ],
  },
};

// Environment-based configuration with URL parameter support
export const getCurrentNetwork = () => {
  const networkName = readNetworkNameFromEnvOrUrl();
  return {
    ethereum: ETHEREUM_NETWORKS[networkName === 'mainnet' ? 'mainnet' : 'sepolia'],
    stellar: STELLAR_NETWORKS[networkName === 'mainnet' ? 'mainnet' : 'testnet'],
  };
};

export const getContractAddresses = () => {
  const networkName = readNetworkNameFromEnvOrUrl();
  return {
    ethereum: CONTRACT_ADDRESSES.ethereum[networkName === 'mainnet' ? 'mainnet' : 'sepolia'],
    stellar: CONTRACT_ADDRESSES.stellar[networkName === 'mainnet' ? 'mainnet' : 'testnet'],
  };
};

export const getFaucets = () => {
  const networkName = (import.meta as any).env?.VITE_NETWORK || 'testnet';
  if (networkName === 'mainnet') {
    return { ethereum: [], stellar: [] };
  }
  return {
    ethereum: FAUCETS.ethereum.sepolia,
    stellar: FAUCETS.stellar.testnet,
  };
};

export const isTestnet = () => readNetworkNameFromEnvOrUrl() !== 'mainnet'; 