import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('./config/networks', () => ({
  isMainnetEnabled: vi.fn(() => false),
  isTestnet: vi.fn(() => true),
  resolveNetworkMode: vi.fn((requested: string) => requested),
  getCurrentNetwork: vi.fn(() => ({
    ethereum: {
      id: 11155111,
      name: 'sepolia',
      displayName: 'Sepolia Testnet',
      rpcUrl: 'https://sepolia.infura.io/v3/test',
      explorerUrl: 'https://sepolia.etherscan.io',
      escrowFactory: '0x3f344ACDd17a0c4D21096da895152820f595dc8A',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'SEP', decimals: 18 },
      testnet: true,
    },
    stellar: {
      name: 'testnet',
      displayName: 'Stellar Testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      explorerUrl: 'https://testnet.stellarchain.io',
      testnet: true,
    },
  })),
  getContractAddresses: vi.fn(() => ({
    ethereum: {
      htlcBridge: '0x3f344ACDd17a0c4D21096da895152820f595dc8A',
      escrowFactory: '0x6c3818E074d891F1FBB3A75913e4BDe87BcF1123',
      testToken: '0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b',
    },
    stellar: {
      bridgeAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      escrowAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
  })),
}));

vi.mock('./lib/useNetworkMode', () => ({
  useNetworkMode: vi.fn(() => ({
    mode: 'testnet' as const,
    expectedEthChainIdHex: '0xaa36a7',
    expectedStellarPassphrase: 'Test SDF Network ; September 2015',
    metamaskChainId: null,
    metamaskConnected: false,
    metamaskMatches: true,
    freighterNetworkPassphrase: null,
    freighterConnected: false,
    freighterMatches: true,
    hasAnyMismatch: false,
    setMode: vi.fn(),
    syncWalletsToAppMode: vi.fn(),
    refreshWalletNetworks: vi.fn(),
  })),
}));

vi.mock('./hooks/useFreighter', () => ({
  useFreighter: vi.fn(() => ({
    isConnected: false,
    address: null,
    isLoading: false,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
  })),
}));

vi.mock('./lib/wakeBackend', () => ({
  pingBackendWake: vi.fn(),
}));

vi.mock('./components/DarkVeil', () => ({
  default: () => null,
}));

vi.mock('./components/BridgeForm', () => ({
  default: () => null,
}));

vi.mock('./components/TransactionHistory', () => ({
  default: () => null,
}));

describe('App — Mainnet safety gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.setItem('oversync:intro-seen', 'true');
  });

  describe('mainnet disabled (VITE_MAINNET_ENABLED unset or false)', () => {
    test('shows "Mainnet Coming" badge when mainnet is disabled', () => {
      render(<App />, { wrapper: MemoryRouter });
      expect(screen.getByText('Mainnet Coming')).toBeInTheDocument();
      expect(
        screen.getByTitle(/v2 mainnet launches after independent audit/i),
      ).toBeInTheDocument();
    });

    test('Mainnet Coming badge is a disabled button when mainnet is disabled', () => {
      render(<App />, { wrapper: MemoryRouter });
      const badge = screen.getByRole('button', { name: 'Mainnet Coming' });
      expect(badge).toBeDisabled();
    });

    test('no mainnet contract addresses, RPC endpoints, or mainnet-specific copy leak in disabled state', () => {
      render(<App />, { wrapper: MemoryRouter });
      expect(
        screen.queryByText(/0xa7bcb4ea/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          /0xa7bCb4EAc8964306F9e3764f67Db6A7af6DdF99A/i,
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/mainnet\.infura\.io/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/ethereum-rpc\.publicnode\.com/i),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/v1 single-relayer bridge active/i),
      ).not.toBeInTheDocument();
    });

    test('Mode metric tile shows "Testnet" when mainnet is disabled', () => {
      render(<App />, { wrapper: MemoryRouter });
      const modeTiles = screen.getAllByText('Testnet');
      expect(modeTiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('mainnet enabled (VITE_MAINNET_ENABLED=true)', () => {
    test('shows network toggle instead of "Mainnet Coming" badge when enabled', async () => {
      const { isMainnetEnabled } = await import('./config/networks');
      vi.mocked(isMainnetEnabled).mockReturnValue(true);

      render(<App />, { wrapper: MemoryRouter });

      expect(screen.queryByText('Mainnet Coming')).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: 'Testnet' });
      expect(toggle).toBeEnabled();
    });
  });
});
