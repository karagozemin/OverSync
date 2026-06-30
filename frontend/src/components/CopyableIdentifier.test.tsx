import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyableIdentifier, copyTextToClipboard } from './CopyableIdentifier';
import { vi } from 'vitest';

const FULL_HASH =
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

describe('copyTextToClipboard', () => {
  test('writes text through the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await copyTextToClipboard(FULL_HASH);

    expect(writeText).toHaveBeenCalledWith(FULL_HASH);
  });

  test('throws when clipboard API is unavailable', async () => {
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });

    await expect(copyTextToClipboard(FULL_HASH)).rejects.toThrow(/Clipboard API unavailable/i);

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });
});

describe('CopyableIdentifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  test('copies the full value on success', async () => {
    render(
      <CopyableIdentifier value={FULL_HASH} truncate copyLabel="transaction hash" />
    );

    await userEvent.click(screen.getByRole('button', { name: /Copy transaction hash/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FULL_HASH);
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });
  });

  test('shows error state when clipboard write fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));

    render(<CopyableIdentifier value={FULL_HASH} copyLabel="order id" />);

    await userEvent.click(screen.getByRole('button', { name: /Copy order id/i }));

    await waitFor(() => {
      expect(screen.getByText('Copy failed')).toBeInTheDocument();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FULL_HASH);
  });

  test('copies full value when UI display text is truncated', async () => {
    render(
      <CopyableIdentifier
        value={FULL_HASH}
        truncate
        truncateHead={10}
        truncateTail={8}
        copyLabel="transaction hash"
      />
    );

    expect(screen.getByText(`${FULL_HASH.slice(0, 10)}...${FULL_HASH.slice(-8)}`)).toBeInTheDocument();
    expect(screen.queryByText(FULL_HASH)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Copy transaction hash/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(FULL_HASH);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(
      `${FULL_HASH.slice(0, 10)}...${FULL_HASH.slice(-8)}`
    );
  });

  test('keeps a fixed-size copy control to avoid layout shift', () => {
    render(<CopyableIdentifier value="42" copyLabel="order id" />);

    const button = screen.getByRole('button', { name: /Copy order id/i });
    expect(button).toHaveClass('h-6');
    expect(button).toHaveClass('w-6');
  });
});
