/**
 * Transaction history pagination.
 *
 * The orders API is stubbed with a *keyset* paginator: a cursor names the last
 * order of the previous page and the stub serves whatever follows it. That is
 * deliberate — an offset-based stub would let an off-by-one in the component
 * pass, which is the exact failure this suite exists to catch.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import TransactionHistory from './TransactionHistory';

const ETH_ADDRESS = '0x1111111111111111111111111111111111111111';
const STELLAR_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422';

interface FixtureOrder {
  id: string;
  createdAt: number;
  amount: string;
}

function makeOrders(count: number, baseCreatedAt: number): FixtureOrder[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `order-${String(i + 1).padStart(2, '0')}`,
    createdAt: baseCreatedAt - i,
    amount: String(i + 1),
  }));
}

/** Atomic units, so the component's own decimal scaling is exercised. */
const ETH_DECIMALS = 18;
const XLM_DECIMALS = 7;

function toAtomic(amount: string, decimals: number): string {
  return `${amount}${'0'.repeat(decimals)}`;
}

/** Coordinator-shaped payload: raw amounts in atomic units. */
function toCoordinatorOrder(order: FixtureOrder) {
  return {
    id: order.id,
    direction: 'eth_to_xlm',
    status: 'completed',
    hashlock: '0x' + 'a'.repeat(64),
    src: {
      chain: 'ethereum',
      address: ETH_ADDRESS,
      asset: 'native',
      amount: toAtomic(order.amount, ETH_DECIMALS),
      safetyDeposit: '10',
      orderId: '0x' + 'b'.repeat(64),
      lockTx: '0x' + 'c'.repeat(64),
      lockBlock: 1,
      timelock: 1_800_000_000,
    },
    dst: {
      chain: 'stellar',
      address: STELLAR_ADDRESS,
      asset: 'native',
      amount: toAtomic(order.amount, XLM_DECIMALS),
      orderId: '0x' + 'd'.repeat(64),
      lockTx: null,
      lockBlock: null,
      timelock: 1_700_000_000,
    },
    secret: { revealed: true, preimage: null, revealedTx: null },
    resolver: '0x' + 'e'.repeat(40),
    createdAt: order.createdAt,
    updatedAt: order.createdAt,
  };
}

interface StubState {
  orders: FixtureOrder[];
  /** Inserted the first time page one is served — a new order mid-walk. */
  insertAfterFirstPage: FixtureOrder | null;
  /** Cursors the stub refuses to serve. */
  rejectCursors: Set<string>;
  requests: Array<Record<string, string>>;
  pageLimit: number;
}

let state: StubState;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function installOrdersApiStub() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://coordinator.test');
    const query = Object.fromEntries(url.searchParams.entries());
    state.requests.push(query);

    const requestedNetwork = query.network;
    if (requestedNetwork !== 'testnet') {
      return jsonResponse(400, {
        error: 'network_mismatch',
        message: 'This coordinator serves testnet, not ' + requestedNetwork,
      });
    }

    if (query.cursor && state.rejectCursors.has(query.cursor)) {
      return jsonResponse(400, {
        error: 'invalid_cursor',
        reason: 'user_mismatch',
        message: 'Cursor was issued for a different user',
      });
    }

    let rows = state.orders;

    // A new order lands after the caller has already seen page one, i.e.
    // while page two is being served. Inserting it on the first request would
    // just put it on page one and test nothing.
    if (state.insertAfterFirstPage && state.requests.length === 2) {
      rows = [state.insertAfterFirstPage, ...rows];
      state.orders = rows;
      state.insertAfterFirstPage = null;
    }

    let start = 0;
    if (query.cursor) {
      // The cursor names the last order of the previous page. Rows inserted
      // above it must not move the boundary.
      const boundary = rows.findIndex((o) => o.id === query.cursor);
      start = boundary === -1 ? rows.length : boundary + 1;
    }

    const limit = Number(query.limit ?? state.pageLimit);
    const page = rows.slice(start, start + limit);
    const hasMore = start + limit < rows.length;
    const last = page[page.length - 1];

    return jsonResponse(200, {
      transactions: page.map(toCoordinatorOrder),
      pagination: {
        limit,
        count: page.length,
        hasMore,
        nextCursor: hasMore && last ? last.id : null,
      },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Each order renders as "<amount> ETH" — count them to detect duplicates. */
function renderedOrderIds(orders: FixtureOrder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const found = screen.queryAllByText(`${order.amount} ETH`, { exact: true });
    counts.set(order.id, found.length);
  }
  return counts;
}

function loadMoreButton() {
  return screen.queryByRole('button', { name: /load more/i });
}

/** Click "Load more" until the coordinator stops handing out cursors. */
async function walkToEnd(user: ReturnType<typeof userEvent.setup>) {
  for (let guard = 0; guard < 20; guard += 1) {
    const button = loadMoreButton();
    if (!button) return;
    const before = state.requests.length;
    await user.click(button);
    await waitFor(() => expect(state.requests.length).toBe(before + 1));
    // Let the fold into the list settle before looking for the next cursor.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  }
  throw new Error('Load more never went away');
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  state = {
    // 12 orders at 5 per page => three pages (5, 5, 2).
    orders: makeOrders(12, 1_700_000_000),
    insertAfterFirstPage: null,
    rejectCursors: new Set(),
    requests: [],
    pageLimit: 5,
  };
  installOrdersApiStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TransactionHistory cursor pagination', () => {
  test('lists every order exactly once across three pages', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(screen.getByText('1 ETH')).toBeInTheDocument());
    expect(screen.getByText('1 ETH')).toBeInTheDocument();
    expect(screen.getByText('5 ETH')).toBeInTheDocument();
    expect(screen.queryByText('6 ETH')).not.toBeInTheDocument();

    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('6 ETH')).toBeInTheDocument());

    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('12 ETH')).toBeInTheDocument());

    for (const [id, count] of renderedOrderIds(state.orders)) {
      expect(count, `${id} should render exactly once`).toBe(1);
    }
  });

  test('hides the Load more button on the final page', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(loadMoreButton()).toBeInTheDocument());
    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('6 ETH')).toBeInTheDocument());
    await user.click(loadMoreButton()!);

    await waitFor(() => expect(screen.queryByText('12 ETH')).toBeInTheDocument());
    expect(loadMoreButton()).not.toBeInTheDocument();
  });

  test('an inserted row does not hide an existing order', async () => {
    const user = userEvent.setup();
    const newcomer: FixtureOrder = {
      id: 'order-00',
      createdAt: 1_700_000_001,
      amount: '99',
    };
    state.insertAfterFirstPage = newcomer;

    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(screen.getByText('1 ETH')).toBeInTheDocument());
    expect(screen.queryByText('99 ETH')).not.toBeInTheDocument();

    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('6 ETH')).toBeInTheDocument());
    await walkToEnd(user);

    // Everything from the original fixture still shows, none of it twice. The
    // newcomer is newer than the page-one boundary, so it is correctly not in
    // this walk — it shows up on the next refresh.
    for (const order of state.orders.filter((o) => o.id !== newcomer.id)) {
      expect(screen.getAllByText(`${order.amount} ETH`, { exact: true }), order.id).toHaveLength(1);
    }
    expect(screen.getByText('12 ETH')).toBeInTheDocument();
    expect(screen.queryByText('99 ETH')).not.toBeInTheDocument();
  });

  test('sends the coordinator cursor back verbatim', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(loadMoreButton()).toBeInTheDocument());
    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('6 ETH')).toBeInTheDocument());

    // First request has no cursor; the second repeats the token the stub issued.
    expect(state.requests[0].cursor).toBeUndefined();
    expect(state.requests[1].cursor).toBe('order-05');
  });

  test('refresh restarts from the newest page', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(loadMoreButton()).toBeInTheDocument());
    await user.click(loadMoreButton()!);
    await waitFor(() => expect(screen.getByText('6 ETH')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(state.requests).toHaveLength(3));
    expect(state.requests[2].cursor).toBeUndefined();
  });
});

describe('TransactionHistory invalid cursor', () => {
  test('shows the error and no partial silent page', async () => {
    const user = userEvent.setup();
    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    await waitFor(() => expect(loadMoreButton()).toBeInTheDocument());
    state.rejectCursors.add('order-05');

    await user.click(loadMoreButton()!);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/cursor was issued for a different user/i)).toBeInTheDocument();

    // The already-loaded page stays put — a rejected cursor must not read as a
    // successful, merely short, final page.
    for (const order of state.orders.slice(0, 5)) {
      expect(screen.getAllByText(`${order.amount} ETH`, { exact: true }), order.id).toHaveLength(1);
    }
    expect(screen.queryByText('6 ETH')).not.toBeInTheDocument();
    expect(loadMoreButton()).not.toBeInTheDocument();
  });

  test('surfaces a coordinator outage instead of an empty-looking history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(503, { error: 'unavailable', message: 'Coordinator is down' }))
    );

    render(<TransactionHistory ethAddress={ETH_ADDRESS} stellarAddress={STELLAR_ADDRESS} />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/coordinator is down/i)).toBeInTheDocument();
  });
});

describe('TransactionHistory claim gating (issue #274)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('keeps the Claimed step unverified when the claim belongs to another order', async () => {
    // The coordinator order below carries a mismatching on-chain order id
    // for the destination leg, so the timeline must not render Claimed.
    const order = coordinatorOrder({
      dst: {
        chain: 'stellar',
        address: 'GSTELLARADDRESS',
        asset: 'XLM',
        amount: '10000000',
        orderId: '999', // different swap
        lockTx: '0xrecovereddstlocktx',
        lockBlock: 2,
        timelock: 9999999999,
      },
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ transactions: [order] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<TransactionHistory ethAddress="0xEthAddress" stellarAddress="GSTELLARADDRESS" />);

    await waitFor(() => {
      expect(screen.getByText('ETH Sepolia')).toBeInTheDocument();
    });

    // A pending testnet order renders its timeline expanded by default.
    await waitFor(() => {
      expect(screen.getByTestId('htlc-timeline')).toBeInTheDocument();
    });
    expect(screen.getByTestId('htlc-step-claimed')).toHaveAttribute('data-step-status', 'unverified');
  });
});
