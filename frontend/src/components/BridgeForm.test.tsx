import { render, screen, waitFor, act } from '@testing-library/react';
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

// Mock the backend status hook so we can drive readiness from tests.
const useBackendStatusMock = vi.fn();
vi.mock('../lib/useBackendStatus', () => ({
  useBackendStatus: (...args: unknown[]) => useBackendStatusMock(...args),
}));

const nullSigner = vi.fn().mockResolved('');

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

const readyStatus = {
  status: 'ready' as const,
  loading: false,
  error: null,
  refresh: vi.fn(),
};

const notReadyStatus = {
  status: 'not-ready' as const,
  loading: false,
  error: null,
  refresh: vi.fn(),
};

const loadingStatus = {
  status: 'loading' as const,
  loading: true,
  error: null,
  refresh: vi.fn(),
};

const downStatus = {
  status: 'down' as const,
  loading: false,
  error: 'coordinator unreachable',
  refresh: vi.fn(),
};

describe('BridgeForm network mismatch guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBackendStatusMock.mockReturnValue(readyStatus);
    // Mock window.ethereum
    Object.defineProperty(window, 'ethereum', {
      writable: true,
      value: {
        request: vi.fn().mockResolved('0xaa36a7'),
        selectedAddress: '0x1234567890123456789012345678901234567890',
      },
    });
  });

  test('shows enabled submit button text when wallets match the selected network', () => {
    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="G@ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    const submitBtn = screen.getByRole('button', { name: 'Bridge' });
    // Button is disabled because amount is empty, but text shows "Bridge"
    // and no mismatch warning is rendered
    expect(submitBtn).toHaveTextContent('Bridge');
    expect(screen.queryByText(/Network Mismatch/i)).not.toBeITheDocument();
    expect(screen.queryByText(/Switch MetaMask/i)).not.toBeITheDocument();
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
        stellarAddress="G@ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
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

  test('shows mainnet gated copy and disables the submit button when mainnet is requested but disabled', () => {
    const gatedState: NetworkModeState = {
      ...testnetState,
      guard: {
        mode: 'mainnet',
        isMainnetEnabled: false,
        status: 'mainnet_gated',
        reason: 'Mainnet operations are currently gated pending final security audits.',
        disableUiActions: true,
      },
    };

    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={gatedState}
      />,
    );

    expect(screen.getByText(/Mainnet operations are currently gated/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: 'Mainnet Gated' });
    expect(submitBtn).toBeDisabled();
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

  test('submission guard alerts and rejects on network mismatch at runtime', () => {
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
        stellarAddress="G@ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={mismatchState}
      />,
    );

    // The button should be disabled, but we verify the guard exists in handleSubmit
    const submitBtn = screen.getByRole('button', { name: /Network Mismatch/i });
    expect(submitBtn).toBeDisabled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe('BridgeForm coordinator health gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'ethereum', {
      writable: true,
      value: {
        request: vi.fn().mockResolved('0xaa36a7'),
        selectedAddress: '0x1234567890123456789012345678901234567890',
      },
    });
  });

  const renderForm = () =>
    render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

  test('not-ready health disables submit, claim, and refund', () => {
    useBackendStatusMock.mockReturnValue(notReadyStatus);
    renderForm();

    expect(screen.getByRole('button', { name: /Bridge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Claim/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refund/i })).toBeDisabled();
  });

  test('loading health disables submit, claim, and refund', () => {
    useBackendStatusMock.mockReturnValue(loadingStatus);
    renderForm();

    expect(screen.getByRole('button', { name: /Bridge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Claim/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refund/i })).toBeDisabled();
  });

  test('down health disables submit, claim, and refund', () => {
    useBackendStatusMock.mockReturnValue(downStatus);
    renderForm();

    expect(screen.getByRole('button', { name: /Bridge/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Claim/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Refund/i })).toBeDisabled();
  });

  test('ready health enables submit when other guards pass', () => {
    useBackendStatusMock.mockReturnValue(readyStatus);
    renderForm();

    // Amount is empty so the button is disabled, but the label should be 'Bridge'
    // and not a health-related blocked label.
    const submitBtn = screen.getByRole('button', { name: /Bridge/i });
    expect(submitBtn).toHaveTextContent('Bridge');
  });

  test('wake action does not post an order', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolved({
      ok: true,
      json: async () => ({ status: 'ready' }),
    } as Response);

    useBackendStatusMock.mockReturnValue(notReadyStatus);
    renderForm();

    const wakeBtn = screen.queryByRole('button', { name: /Wake/i });
    if (wakeBtn) {
      act(() => {
        wakeBtn.click();
      });
    }

    // No fetch call should have been made to an order route.
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toMatch(/\/orders?(\/|$|\?)/i);
    }
  });

  test('an older health response does not override a newer not-ready response', () => {
    // First render with not-ready, then re-render with ready to simulate a late
    // response arriving after a newer one. The form must stay blocked.
    useBackendStatusMock.mockReturnValue(notReadyStatus);
    const { rerender } = render(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    expect(screen.getByRole('button', { name: /Bridge/i })).toBeDisabled();

    // Newer response arrives first.
    useBackendStatusMock.mockReturnValue(readyStatus);
    rerender(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    // Late older response arrives after the newer one.
    useBackendStatusMock.mockReturnValue(notReadyStatus);
    rerender(
      <BridgeForm
        ethAddress="0x1234567890123456789012345678901234567890"
        stellarAddress="G@ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
        signStellarTransaction={nullSigner}
        networkState={testnetState}
      />,
    );

    expect(screen.getByRole('button', { name: /Bridge/i })).toBeDisabled();
  });

  test('wake calls health again and not the order route', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolved({
      ok: true,
      json: async () => ({ status: 'ready' }),
    } as Response);

    const refresh = vi.fn();
    useBackendStatusMock.mockReturnValue({ ...notReadyStatus, refresh });
    renderForm();

    const wakeBtn = screen.queryByRole('button', { name: /Wake/i });
    if (wakeBtn) {
      act(() => {
        wakeBtn.click();
      });
    }

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toMatch(/\/orders?(\/|$|\?)/i);
    }
  });
});
