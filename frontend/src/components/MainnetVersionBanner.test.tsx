import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, vi } from 'vitest';
import MainnetVersionBanner from './MainnetVersionBanner';

const mockNetworkState = {
  mode: 'mainnet' as const,
  expectedEthChainIdHex: '0x1',
  expectedStellarPassphrase: 'Public Global Stellar Network ; September 2015',
  metamaskChainId: null,
  metamaskConnected: false,
  metamaskMatches: true,
  freighterNetworkPassphrase: null,
  freighterConnected: false,
  freighterMatches: true,
  hasAnyMismatch: false,
  setMode: vi.fn().mockResolvedValue({ ok: true }),
  syncWalletsToAppMode: vi.fn().mockResolvedValue({ ok: true }),
  refreshWalletNetworks: vi.fn(),
};

describe('MainnetVersionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders mainnet info when mode is mainnet', () => {
    render(<MainnetVersionBanner networkState={{ ...mockNetworkState, mode: 'mainnet' }} />);
    expect(screen.getByText(/v1 single-relayer bridge active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try v2 on testnet/i })).toBeInTheDocument();
  });

  test('does not render when mode is testnet (disabled state)', () => {
    render(<MainnetVersionBanner networkState={{ ...mockNetworkState, mode: 'testnet' }} />);
    expect(screen.queryByText(/v1 single-relayer bridge active/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Try v2 on testnet/i })).not.toBeInTheDocument();
  });

  test('calls setMode("testnet") when "Try v2 on testnet" is clicked', async () => {
    const setMode = vi.fn().mockResolvedValue({ ok: true });
    render(
      <MainnetVersionBanner
        networkState={{ ...mockNetworkState, mode: 'mainnet', setMode }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Try v2 on testnet/i }));
    expect(setMode).toHaveBeenCalledWith('testnet');
  });
});
