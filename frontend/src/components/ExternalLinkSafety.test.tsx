import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { buildHtlcReceipt } from '../lib/parseHtlcReceipt';
import InvestorMode from '../pages/InvestorMode';
import HtlcReceiptCard from './HtlcReceiptCard';
import SafeExternalLink from './SafeExternalLink';

const SAFE_REL = 'noopener noreferrer';

const ETH_HASH = '0x' + 'a'.repeat(64);
const STELLAR_HASH = 'b'.repeat(64);
const REFUND_HASH = '0x' + 'c'.repeat(64);

function expectProtectedLink(link: HTMLElement) {
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', SAFE_REL);
  const tokens = (link.getAttribute('rel') ?? '').split(/\s+/);
  expect(tokens).toContain('noopener');
  expect(tokens).toContain('noreferrer');
}

function expectEveryBlankTargetIsSafe(container: HTMLElement) {
  const blankLinks = Array.from(container.querySelectorAll('a[target="_blank"]'));
  expect(blankLinks.length).toBeGreaterThan(0);
  blankLinks.forEach(expectProtectedLink);
}

describe('external explorer links', () => {
  it('opens safe links in a new tab even if unsafe anchor props are supplied', () => {
    // The helper owns target/rel so individual call sites cannot drop them.
    const { container } = render(
      <SafeExternalLink
        href="https://example.test/explorer"
        {...({ rel: 'opener', target: '_self' } as Record<string, string>)}
      >
        Explorer
      </SafeExternalLink>,
    );

    const link = screen.getByRole('link', { name: 'Explorer' });
    expect(link).toHaveAttribute('href', 'https://example.test/explorer');
    expectProtectedLink(link);
    expectEveryBlankTargetIsSafe(container);
  });

  it('keeps contract proof URLs and labels on protected investor links', () => {
    const { container } = render(
      <MemoryRouter>
        <InvestorMode />
      </MemoryRouter>,
    );

    const etherscan = screen.getByRole('link', { name: /View on Etherscan/i });
    expect(etherscan).toHaveAttribute(
      'href',
      'https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178',
    );
    expect(etherscan).toHaveTextContent('View on Etherscan');
    expectProtectedLink(etherscan);

    const stellarExpert = screen.getByRole('link', { name: /View on Stellar Explorer/i });
    expect(stellarExpert).toHaveAttribute(
      'href',
      'https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK',
    );
    expect(stellarExpert).toHaveTextContent('View on Stellar Explorer');
    expectProtectedLink(stellarExpert);
    expectEveryBlankTargetIsSafe(container);
  });

  it('keeps receipt explorer URLs and labels on protected receipt links', () => {
    const receipt = buildHtlcReceipt({
      orderId: 'order-123',
      direction: 'eth-to-xlm',
      amount: '1',
      fromToken: 'ETH',
      toToken: 'XLM',
      estimatedAmount: '1',
      status: 'cancelled',
      ethTxHash: ETH_HASH,
      stellarTxHash: STELLAR_HASH,
      refundTxHash: REFUND_HASH,
      refundNetwork: 'ethereum',
    });

    const { container } = render(<HtlcReceiptCard receipt={receipt} />);

    const linkFor = (href: string): HTMLElement => {
      const link = container.querySelector(`a[href="${href}"]`);
      expect(link).not.toBeNull();
      return link as HTMLElement;
    };

    const lockLink = linkFor(`https://sepolia.etherscan.io/tx/${ETH_HASH}`);
    expect(lockLink).toHaveTextContent('Etherscan');
    expectProtectedLink(lockLink);

    const claimLink = linkFor(`https://stellar.expert/explorer/testnet/tx/${STELLAR_HASH}`);
    expect(claimLink).toHaveTextContent('Stellar Expert');
    expectProtectedLink(claimLink);

    const refundLink = linkFor(`https://sepolia.etherscan.io/tx/${REFUND_HASH}`);
    expect(refundLink).toHaveTextContent('Etherscan');
    expectProtectedLink(refundLink);
    expectEveryBlankTargetIsSafe(container);
  });
});
