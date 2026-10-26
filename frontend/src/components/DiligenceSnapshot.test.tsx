import React from 'react';
import { render, screen } from '@testing-library/react';
import { DiligenceSnapshot } from './DiligenceSnapshot';
import { DeploymentContext } from '../context/DeploymentContext';

const mockDeploymentRecord = {
  registryAddress: '0x1234567890123456789012345678901234567890',
  escrowAddress: '0x0987654321098765432109876543210987654321',
  networkId: '1',
  bytecodeHashes: {
    'ContractA': '0xabcdef1234567890abcdef1234567890abcdef12',
    'ContractB': '0x1234567890abcdef1234567890abcdef12345678'
  }
};

const mockSelfCheckRecord = {
  registryAddress: '0x1234567890123456789012345678901234567890',
  escrowAddress: '0x0987654321098765432109876543210987654321',
  networkId: '1',
  bytecodeHashes: {
    'ContractA': '0xabcdef1234567890abcdef1234567890abcdef12',
    'ContractB': '0x1234567890abcdef1234567890abcdef12345678'
  }
};

const mockMismatchedSelfCheckRecord = {
  registryAddress: '0x1111111111111111111111111111111111111111',
  escrowAddress: '0x0987654321098765432109876543210987654321',
  networkId: '1',
  bytecodeHashes: {
    'ContractA': '0xabcdef1234567890abcdef1234567890abcdef12',
    'ContractB': '0x1234567890abcdef1234567890abcdef12345678'
  }
};

const mockBytecodeMismatchRecord = {
  registryAddress: '0x1234567890123456789012345678901234567890',
  escrowAddress: '0x0987654321098765432109876543210987654321',
  networkId: '1',
  bytecodeHashes: {
    'ContractA': '0xabcdef1234567890abcdef1234567890abcdef12',
    'ContractB': '0x9999999999999999999999999999999999999999'
  }
};

describe('DiligenceSnapshot', () => {
  const renderWithContext = (selfCheckRecord: any, deploymentRecord?: any) => {
    return render(
      <DeploymentContext.Provider value={{ deploymentRecord: deploymentRecord || mockDeploymentRecord }}>
        <DiligenceSnapshot selfCheckRecord={selfCheckRecord} />
      </DeploymentContext.Provider>
    );
  };

  it('renders snapshot with matching deployment record', () => {
    renderWithContext(mockSelfCheckRecord);

    expect(screen.getByTestId('dil-snapshot-visible')).toBeInTheDocument();
    expect(screen.getByText('Diligence Snapshot')).toBeInTheDocument();
    expect(screen.getByText(mockDeploymentRecord.registryAddress)).toBeInTheDocument();
    expect(screen.getByText(mockDeploymentRecord.escrowAddress)).toBeInTheDocument();
    expect(screen.getByText(/ContractA: 0xabcdef...cdef12/i)).toBeInTheDocument();
  });

  it('hides snapshot when registry address differs', () => {
    renderWithContext(mockMismatchedSelfCheckRecord);

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByText(/Snapshot hidden due to mismatched deployment record/i)).toBeInTheDocument();
    expect(screen.getByText(/registry: expected 0x1111111111111111111111111111111111111111, got 0x1234567890123456789012345678901234567890/i)).toBeInTheDocument();
  });

  it('hides snapshot when bytecode hashes differ', () => {
    renderWithContext(mockBytecodeMismatchRecord);

    expect(screen.getByTestId('dil-snapshot-hidden')).toBeInTheDocument();
    expect(screen.getByText(/bytecode hashes do not match/i)).toBeInTheDocument();
  });

  it('does not expose secrets in visible text', () => {
    renderWithContext(mockSelfCheckRecord);

    const visibleText = screen.getByTestId('dil-snapshot-visible').textContent;
    expect(visibleText).not.toContain('secret');
    expect(visibleText).not.toContain('private');
    expect(visibleText).not.toContain('deployer');
  });

  it('shows network name from config when available', () => {
    renderWithContext(mockSelfCheckRecord);

    expect(screen.getByText('Ethereum Mainnet')).toBeInTheDocument();
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
