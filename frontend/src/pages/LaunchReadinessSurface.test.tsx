import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import LaunchReadinessSurface from './LaunchReadinessSurface';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/launch-readiness" element={<LaunchReadinessSurface />} />
        <Route path="/" element={<div data-testid="bridge-stub">Bridge placeholder</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LaunchReadinessSurface', () => {
  test('renders the page heading, intro and the audit-gate timeline', () => {
    renderAt('/launch-readiness');

    expect(
      screen.getByRole('heading', { level: 1, name: /Launch readiness/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId('audit-gate-timeline')).toBeInTheDocument();
  });

  test('renders the testnet traction card with measured metrics', () => {
    renderAt('/launch-readiness');

    expect(screen.getByText('Testnet traction')).toBeInTheDocument();
    expect(screen.getByText('Public metrics')).toBeInTheDocument();
    expect(screen.getByText('Deployed contracts')).toBeInTheDocument();
    expect(screen.getByText('Supported testnet routes')).toBeInTheDocument();
    expect(screen.getByText('ETH / XLM')).toBeInTheDocument();
  });

  test('locks the audit-first disclaimer copy so the suppression contract cannot regress', () => {
    renderAt('/launch-readiness');

    // The disclaimer must include the audit-first policy wording
    expect(screen.getByText(/Project policy: audit-first/i)).toBeInTheDocument();
    // The disclaimer must explicitly call out the VITE_MAINNET_ENABLED=false flag
    expect(screen.getByText(/VITE_MAINNET_ENABLED=false/i)).toBeInTheDocument();
  });

  test('does not contain forbidden phrases that would imply mainnet is live', () => {
    renderAt('/launch-readiness');

    // The page body must not suggest mainnet is live
    expect(
      screen.queryByText(/mainnet is live/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/mainnet enabled/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/audit (is )?(complete|done|passed)/i)
    ).not.toBeInTheDocument();
  });

  test('back-to-bridge link uses client-side navigation back to /', async () => {
    const user = userEvent.setup();
    renderAt('/launch-readiness');

    const back = screen.getByRole('link', { name: /Back to bridge/i });
    expect(back).toHaveAttribute('href', '/');

    await user.click(back);
    expect(await screen.findByTestId('bridge-stub')).toBeInTheDocument();
  });

  test('does not import or call any bridge execution / settlement hooks', async () => {
    // Verifies the surface is purely a render surface and hits no wallet
    // execution paths. We can't introspect imports statically here, but we
    // can assert that no window.ethereum interaction is triggered on mount.
    const requested: string[] = [];
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: vi.fn((args: { method: string }) => {
          requested.push(args.method);
          return Promise.resolve([]);
        }),
      },
    });
    const { default: FreshMount } = await import('./LaunchReadinessSurface');
    render(
      <MemoryRouter initialEntries={['/launch-readiness']}>
        <FreshMount />
      </MemoryRouter>
    );

    // eth_accounts is requested by App.tsx's MetaMask auto-connect effect;
    // LaunchReadinessSurface must NOT trigger it.
    expect(requested).not.toContain('eth_accounts');
    expect(requested).not.toContain('eth_requestAccounts');
  });
});
