import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import OrderRecoveryBanner from './OrderRecoveryBanner';

describe('OrderRecoveryBanner', () => {
  it('does not render when order is fresh and there is no error', () => {
    const { container } = render(
      <OrderRecoveryBanner isStale={false} freshnessError={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders stale warning when isStale is true', () => {
    render(<OrderRecoveryBanner isStale={true} freshnessError={null} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Order is stale or expired/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Claim and refund actions are disabled/i)
    ).toBeInTheDocument();
  });

  it('renders error banner with retry button when freshnessError is provided', async () => {
    const onRetry = vi.fn();

    render(
      <OrderRecoveryBanner
        isStale={false}
        freshnessError="Network request timed out"
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Could not verify order freshness/i)).toBeInTheDocument();
    expect(screen.getByText(/Network request timed out/i)).toBeInTheDocument();
    expect(screen.getByText(/The restored order is still displayed/i)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Retry freshness/i });
    expect(retryButton).toBeInTheDocument();
    expect(retryButton).toBeEnabled();

    await userEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry button when isRetrying is true', () => {
    render(
      <OrderRecoveryBanner
        isStale={false}
        freshnessError="Error"
        onRetry={vi.fn()}
        isRetrying={true}
      />
    );

    const retryButton = screen.getByRole('button', { name: /Retrying.../i });
    expect(retryButton).toBeDisabled();
  });
});
