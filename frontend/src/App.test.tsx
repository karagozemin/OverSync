import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('./config/networks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config/networks')>();
  return {
    ...actual,
    // Only the mainnet flag is stubbed so the safety-gate tests can toggle it;
    // the real getCurrentNetwork / getContractAddresses / isTestnet helpers are
    // kept so components that render them don't hit a missing-export mock.
    isMainnetEnabled: vi.fn(() => false),
  };
});

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
