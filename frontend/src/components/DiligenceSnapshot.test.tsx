import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import DiligenceSnapshot from './DiligenceSnapshot';
import {
  buildDeploymentRecord,
  diffDeploymentRecords,
  getDeploymentRecord,
} from '../config/deployment';
import { getSelfCheckDeploymentRecord } from './DeploymentSelfCheck';

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
