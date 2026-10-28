import { render, screen } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';
import DiligenceSnapshot from './DiligenceSnapshot';
import { getSelfCheckDeploymentRecord } from './DeploymentSelfCheck';
import { buildDeploymentRecord, diffDeploymentRecords, getDeploymentRecord } from '../config/deployment';

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

describe('DiligenceSnapshot — shared deployment record', () => {
  const RECORD = buildDeploymentRecord({
    network: 'testnet',
    ethereum: {
      chainId: 11155111,
      contracts: {
        HTLCEscrow: '0x1111111111111111111111111111111111111111',
        ResolverRegistry: '0x2222222222222222222222222222222222222222',
      },
      codeHashes: { HTLCEscrow: '0x' + 'a'.repeat(64), ResolverRegistry: { codeHash: '0x' + 'b'.repeat(64) } },
      deployer: '0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c',
      deployerPrivateKey: '0x' + 'f'.repeat(64),
    },
    stellar: {
      contracts: { HTLC: 'CHTLCFIXTURE', ResolverRegistry: 'CREGISTRYFIXTURE' },
      codeHashes: { HTLC: 'c'.repeat(64) },
      deployer: 'GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL',
      deployerSecret: 'SDEPLOYERSECRETFIXTURE',
    },
  });

  test('a matching record renders the snapshot fields from that record', () => {
    render(<DiligenceSnapshot record={RECORD} selfCheckRecord={{ ...RECORD }} />);

    expect(screen.queryByTestId('diligence-snapshot-mismatch')).not.toBeInTheDocument();
    expect(screen.getByTestId('diligence-snapshot-network')).toHaveTextContent('testnet');
    expect(screen.getByText('0x1111111111111111111111111111111111111111')).toBeInTheDocument();
    expect(screen.getByText('0x2222222222222222222222222222222222222222')).toBeInTheDocument();
    expect(screen.getByText('CHTLCFIXTURE')).toBeInTheDocument();
    expect(screen.getByText('CREGISTRYFIXTURE')).toBeInTheDocument();
    expect(screen.getByText('0x' + 'a'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText('0x' + 'b'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText('c'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText('Stellar Testnet ResolverRegistry wasm hash').nextSibling).toHaveTextContent('Not recorded');
  });

  test('a different registry address hides the snapshot and names the field', () => {
    const selfCheck = {
      ...RECORD,
      ethereum: { ...RECORD.ethereum, registry: '0x3333333333333333333333333333333333333333' },
    };
    render(<DiligenceSnapshot record={RECORD} selfCheckRecord={selfCheck} />);

    expect(screen.getByTestId('diligence-snapshot-mismatch')).toHaveTextContent('ethereum.registry');
    expect(screen.queryByText('0x1111111111111111111111111111111111111111')).not.toBeInTheDocument();
    expect(screen.queryByText('0x2222222222222222222222222222222222222222')).not.toBeInTheDocument();
    expect(screen.queryByText('0x3333333333333333333333333333333333333333')).not.toBeInTheDocument();
  });

  test('the visible text does not contain a secret or deployer', () => {
    const { container } = render(<DiligenceSnapshot record={RECORD} selfCheckRecord={RECORD} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('f'.repeat(64));
    expect(text).not.toContain('SDEPLOYERSECRETFIXTURE');
    expect(text).not.toMatch(/deployer/i);
    expect(text).not.toContain('0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c');
  });

  test('defaults render the same record the self-check reports (no wallet needed)', () => {
    expect(diffDeploymentRecords(getDeploymentRecord(), getSelfCheckDeploymentRecord())).toEqual([]);
    render(<DiligenceSnapshot />);
    expect(screen.queryByTestId('diligence-snapshot-mismatch')).not.toBeInTheDocument();
  });
});
