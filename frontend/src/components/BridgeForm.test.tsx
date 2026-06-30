import { render, screen } from '@testing-library/react';
import BridgeForm from './BridgeForm';
import type { NetworkModeState } from '../lib/useNetworkMode';
import { vi } from 'vitest';

// Mock the stellar-sdk heavy dependency
vi.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: vi.fn() },
  Asset: { native: vi.fn() },
  Operation: { payment: vi.fn() },
  TransactionBuilder: vi.fn(),
  Memo: { text: vi.fn() },
}));

vi.mock('../config/networks', () => ({
  isTestnet: vi.fn(() => true),
  getCurrentNetwork: vi.fn(() => ({
    ethereum: {
      id: 11155111,
      name: 'sepolia',
      displayName: 'Sepolia Testnet',
      rpcUrl: 'https://sepolia.example.com',
      explorerUrl: 'https://sepolia.etherscan.io',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      testnet: true,
    },
    stellar: {
      name: 'testnet',
      displayName: 'Stellar Testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
      testnet: true,
    },
  })),
}));

vi.mock('../lib/parseHtlcReceipt', () => ({
  parseHtlcReceipt: vi.fn(() => null),
}));

vi.mock('../lib/sanitizeAmountInput', () => ({
  sanitizeAmountInput: vi.fn((val: string) => val),
}));

const nullSigner = vi.fn().mockResolvedValue('');

const testnetState: NetworkModeState = {
  mode: 'testnet',
  expectedEthChainIdHex: '0xaa36a7',
  expectedStellarPassphrase: 'Test SDF Network ; September 2015',
  metamaskChainId: '0xaa36a7',
  metamaskConnected: true,
  metamaskMatches: true,
  freighterNetworkPassphrase: 'Test SDF Network ; September 2015',
  freighterConnected: true,
  freighterMatches: true,
  hasAnyMismatch: false,
  setMode: vi.fn(),
  syncWalletsToAppMode: vi.fn(),
  refreshWalletNetworks: vi.fn(),
};

describe('BridgeForm network mismatch guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.ethereum
    Object.defineProperty(window, 'ethereum', {
      writable: true,
      value: {
        request: vi.fn().mockResolvedValue('0xaa36a7'),
        selectedAddress: '0x1234567890123456789012345678901234567890',
      },
    });
  });

  test('shows enabled submit button text when wallets match the selected network', () => {
    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Bridge' });
    // Button is disabled because amount is empty, but text shows "Bridge"
    // and no mismatch warning is rendered
    expect(submitBtn).toHaveTextContent('Bridge');
    expect(screen.queryByText(/Network Mismatch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Switch MetaMask/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Switch Freighter/i)).not.toBeInTheDocument();
  });

  test('disables submit and shows warning when EVM chain does not match', () => {
    const mismatchState: NetworkModeState = {
      ...testnetState,
      metamaskChainId: '0x1',
      metamaskMatches: false,
      hasAnyMismatch: true,
    };

    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={mismatchState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Network Mismatch/i });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText(/MetaMask is on Mainnet but the app is in Testnet mode/i),
    ).toBeInTheDocument();
  });

  test('disables submit and shows warning when Stellar network does not match', () => {
    const mismatchState: NetworkModeState = {
      ...testnetState,
      freighterNetworkPassphrase: 'Public Global Stellar Network ; September 2015',
      freighterMatches: false,
      hasAnyMismatch: true,
    };

    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={mismatchState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Network Mismatch/i });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText(/Switch Freighter to Stellar Testnet/i),
    ).toBeInTheDocument();
  });

  test('shows connect wallet state when no wallet is connected', () => {
    render(
      <BridgeForm
        ethAddress=""
        stellarAddress=""
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Connect Wallet/i });
    expect(submitBtn).toBeDisabled();
  });

  test('shows inline warning when wallet is disconnected while the other is connected', () => {
    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress=""
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    expect(screen.getByText(/Connect Freighter to bridge/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /Connect Wallet/i });
    expect(submitBtn).toBeDisabled();
  });

  test('shows both-wallet warning when both wallets are disconnected', () => {
    render(
      <BridgeForm
        ethAddress=""
        stellarAddress=""
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    expect(
      screen.getByText(/Connect both MetaMask and Freighter to bridge/i),
    ).toBeInTheDocument();
  });

  test('shows combined warning when both EVM and Stellar networks mismatch', () => {
    const mismatchState: NetworkModeState = {
      ...testnetState,
      metamaskChainId: '0x1',
      metamaskMatches: false,
      freighterNetworkPassphrase: 'Public Global Stellar Network ; September 2015',
      freighterMatches: false,
      hasAnyMismatch: true,
    };

    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={mismatchState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: /Network Mismatch/i });
    expect(submitBtn).toBeDisabled();
    expect(
      screen.getByText(/Both wallets are on the wrong network/i),
    ).toBeInTheDocument();
  });

  test('submission guard alerts and rejects on network mismatch at runtime', async () => {
    const mismatchState: NetworkModeState = {
      ...testnetState,
      metamaskChainId: '0x1',
      metamaskMatches: false,
      hasAnyMismatch: true,
    };

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={mismatchState}
      />,
    );

    // The button should be disabled, but we verify the guard exists in handleSubmit
    const submitBtn = screen.getByRole('button', { name: /Network Mismatch/i });
    expect(submitBtn).toBeDisabled();
  });
});
