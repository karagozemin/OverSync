import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import DiligenceSnapshot from './DiligenceSnapshot';

// Mock networks config
vi.mock('../config/networks', () => ({
  isMainnetEnabled: vi.fn(() => false),
  ETHEREUM_NETWORKS: {
    sepolia: {
      explorerUrl: 'https://sepolia.etherscan.io',
    },
  },
}));

// Mutable mock object for deployments
const { mockDeployments } = vi.hoisted(() => {
  return {
    mockDeployments: {
      ethereum: {
        contracts: {
          HTLCEscrow: '0xb352339BEb146f2699d28D736700B953988bB178',
          ResolverRegistry: '0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99',
        },
      },
      stellar: {
        contracts: {
          HTLC: 'CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK',
          ResolverRegistry: 'CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF',
        },
      },
    }
  };
});

vi.mock('../../../deployments.testnet.json', () => ({
  default: mockDeployments,
}));

describe('DiligenceSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders panel and configured values correctly', () => {
    render(<DiligenceSnapshot />);

    // Check title/header
    expect(screen.getByText('Diligence Snapshot')).toBeInTheDocument();
    expect(screen.getByText(/"No validator set, no attester, HTLC refund path."/i)).toBeInTheDocument();

    // Check public mode status
    expect(screen.getByText('Testnet-only')).toBeInTheDocument();

    // Check EVM contract addresses and explorer links
    const ethHtlc = screen.getByText('0xb352339BEb146f2699d28D736700B953988bB178');
    expect(ethHtlc).toBeInTheDocument();
    expect(ethHtlc.closest('a')).toHaveAttribute(
      'href',
      'https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178'
    );

    const ethRegistry = screen.getByText('0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99');
    expect(ethRegistry).toBeInTheDocument();
    expect(ethRegistry.closest('a')).toHaveAttribute(
      'href',
      'https://sepolia.etherscan.io/address/0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99'
    );

    // Check Stellar contract IDs and explorer links
    const stellarHtlc = screen.getByText('CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK');
    expect(stellarHtlc).toBeInTheDocument();
    expect(stellarHtlc.closest('a')).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK'
    );

    const stellarRegistry = screen.getByText('CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF');
    expect(stellarRegistry).toBeInTheDocument();
    expect(stellarRegistry.closest('a')).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/contract/CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF'
    );
  });

  test('displays "Not configured" for missing values', () => {
    // Temporarily mutate mockDeployments
    const originalEthHtlc = mockDeployments.ethereum.contracts.HTLCEscrow;
    (mockDeployments.ethereum.contracts as any).HTLCEscrow = '';

    render(<DiligenceSnapshot />);
    
    // The mutated value should result in "Not configured"
    expect(screen.queryByText(originalEthHtlc)).not.toBeInTheDocument();
    expect(screen.getByText('Sepolia HTLC contract').nextSibling).toHaveTextContent('Not configured');

    // Restore
    mockDeployments.ethereum.contracts.HTLCEscrow = originalEthHtlc;
  });

  test('renders without wallet connection required', () => {
    const { container } = render(<DiligenceSnapshot />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
