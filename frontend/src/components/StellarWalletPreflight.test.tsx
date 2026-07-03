import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StellarWalletPreflight from './StellarWalletPreflight';
import { useFreighter } from '../hooks/useFreighter';
import { isTestnet } from '../config/networks';

// Mock useFreighter hook
vi.mock('../hooks/useFreighter', () => ({
  useFreighter: vi.fn(),
}));

// Mock config networks
vi.mock('../config/networks', () => ({
  isTestnet: vi.fn(() => true),
}));

const mockCheckWalletReadiness = vi.fn();

const readyState = {
  freighterReachable: true,
  isConnected: true,
  accountPresent: true,
  testnetSelected: true,
  accountFunded: true,
  horizonReachable: true,
  errors: [],
};

const unreachableState = {
  freighterReachable: false,
  isConnected: false,
  accountPresent: false,
  testnetSelected: false,
  accountFunded: false,
  horizonReachable: false,
  errors: ['Freighter extension not available', 'Freighter wallet not connected', 'No account address found', 'Wrong network: Testnet not selected', 'Account does not exist or is unfunded', 'Horizon RPC is not reachable'],
};

const makeFreighterMock = (state: any, shouldThrow = false) => {
  const mockFreighter = {
    checkWalletReadiness: shouldThrow ? vi.fn().mockRejectedValue(new Error('Network error')) : vi.fn().mockResolvedValue(state),
  };
  vi.mocked(useFreighter).mockReturnValue(mockFreighter);
  return mockFreighter;
};

describe('StellarWalletPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTestnet).mockReturnValue(true);
  });

  it('does not render when isVisible is false', () => {
    makeFreighterMock(readyState);
    const { container } = render(<StellarWalletPreflight isVisible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders loading state initially', () => {
    makeFreighterMock(readyState);
    const { container } = render(<StellarWalletPreflight isVisible={true} />);
    expect(screen.getByText('Checking wallet readiness...')).toBeInTheDocument();
    expect(container.querySelector('.wallet-preflight-progress-fill')).toHaveStyle({ width: '0%' });
  });

  it('renders wallet readiness check results', async () => {
    makeFreighterMock(readyState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Stellar Wallet Readiness Check')).toBeInTheDocument();
    expect(screen.getByText('100% Complete')).toBeInTheDocument();
    expect(screen.getByText('✅ Wallet Ready')).toBeInTheDocument();
    expect(screen.queryAllByText('⚠️ Wallet Not Ready').length).toBe(0);

    const checks = screen.getAllByText(/Freighter reachable|Wallet connected|Account present|Testnet selected|Account funded|Horizon RPC reachable/);
    expect(checks).toHaveLength(6);
  });

  it('renders wallet not ready state with errors', async () => {
    makeFreighterMock(unreachableState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('⚠️ Wallet Not Ready')).toBeInTheDocument();
    expect(screen.getByText('100% Complete')).toBeInTheDocument();

    const errorItems = screen.getAllByRole('listitem');
    expect(errorItems).toHaveLength(6);

    expect(screen.getByText('Issues to fix:')).toBeInTheDocument();
  });

  it('shows correct next step for freighter not reachable', async () => {
    makeFreighterMock(unreachableState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    const nextStepText = screen.getByText('Next step:');
    const nextStepParagraph = nextStepText.closest('p');
    expect(nextStepParagraph).toHaveTextContent('Install Freighter from https://freighter.app/');
  });

  it('shows correct next step for wallet not connected', async () => {
    const partialState = { ...unreachableState };
    partialState.freighterReachable = true;
    partialState.isConnected = false;
    partialState.errors = ['Freighter wallet not connected'];

    makeFreighterMock(partialState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Next step:')).toBeInTheDocument();
    expect(screen.getByText('Click "Connect Wallet" in Freighter and select your account')).toBeInTheDocument();
  });

  it('shows correct next step for wrong network', async () => {
    const partialState = { ...unreachableState };
    partialState.testnetSelected = false;
    partialState.errors = ['Wrong network: Testnet not selected'];

    makeFreighterMock(partialState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Next step:')).toBeInTheDocument();
    expect(screen.getByText('Switch to Stellar Testnet in Freighter settings')).toBeInTheDocument();
  });

  it('shows correct next step for unfunded account', async () => {
    const partialState = { ...unreachableState };
    partialState.accountFunded = false;
    partialState.errors = ['Account does not exist or is unfunded'];

    makeFreighterMock(partialState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Next step:')).toBeInTheDocument();
    expect(screen.getByText('Visit https://laboratory.stellar.org/#account-creator to fund your testnet account')).toBeInTheDocument();
  });

  it('retries check when retry button is clicked', async () => {
    makeFreighterMock(unreachableState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    const retryButton = screen.getByRole('button', { name: /Retry Check/i });
    await userEvent.click(retryButton);

    expect(mockCheckWalletReadiness).toHaveBeenCalledTimes(1);
  });

  it('handles checkWalletReadiness throwing an error', async () => {
    const mockFreighter = makeFreighterMock(readyState, true);
    mockCheckWalletReadiness.mockRejectedValue(new Error('Network error'));

    render(<StellarWalletPreflight isVisible={true} />);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('⚠️ Wallet Not Ready')).toBeInTheDocument();
    expect(screen.getByText('Failed to check wallet readiness')).toBeInTheDocument();
  });

  it('calls onReady callback when ready', async () => {
    const mockOnReady = vi.fn();
    makeFreighterMock(readyState);

    render(<StellarWalletPreflight isVisible={true} onReady={mockOnReady} />);

    await waitFor(() => {
      expect(mockOnReady).toHaveBeenCalledWith(true);
    });
  });

  it('calls onReady callback when not ready', async () => {
    const mockOnReady = vi.fn();
    makeFreighterMock(unreachableState);

    render(<StellarWalletPreflight isVisible={true} onReady={mockOnReady} />);

    await waitFor(() => {
      expect(mockOnReady).toHaveBeenCalledWith(false);
    });
  });

  it('calculates progress percentage correctly', async () => {
    const partialState = {
      freighterReachable: true,
      isConnected: false,
      accountPresent: false,
      testnetSelected: false,
      accountFunded: false,
      horizonReachable: false,
      errors: [],
    };

    makeFreighterMock(partialState);

    await waitFor(() => {
      expect(screen.queryByText('Checking wallet readiness...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('17% Complete')).toBeInTheDocument();
  });
});
