import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuoterService, type QuoteResponse } from '../src/quoter-service.js';
import {
  RelaySubmissionTracker,
  RelayTerminalError,
  type RelayAction,
} from '../src/relay-submission-tracker.js';

const quote = (validUntil: number): QuoteResponse => ({
  quoteId: 'relayer-quote',
  fromToken: '0xasset-a',
  toToken: 'XLM',
  fromChain: 'ethereum',
  toChain: 'stellar',
  fromAmount: '1000',
  validUntil,
} as QuoteResponse);

const action: RelayAction = {
  orderId: 'order-1',
  side: 'eth_to_xlm',
  action: 'claim',
  chain: 'stellar',
  amount: '1000',
};

function makeStager(executor: () => Promise<{ hash: string }>) {
  return () => ({ txHash: 'tx-1', broadcast: executor });
}

function coordinatorResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    fresh: true,
    fromAsset: '0xasset-a',
    toAsset: 'XLM',
    amount: '1000',
    fromNetwork: 'ethereum',
    toNetwork: 'stellar',
    expiresAt: Date.now() + 30_000,
    ...overrides,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('QuoterService coordinator quote gate', () => {
  it('submits a matching unexpired quote to the tracker once', async () => {
    const expiresAt = Date.now() + 30_000;
    const fetchStub = vi.fn().mockResolvedValue(coordinatorResponse({ expiresAt }));
    vi.stubGlobal('fetch', fetchStub);
    const service = new QuoterService();
    const tracker = new RelaySubmissionTracker({ sleep: async () => undefined });
    const executor = vi.fn().mockResolvedValue({ hash: 'tx-1' });

    const first = await service.submitIfCoordinatorQuoteMatches(
      quote(expiresAt), 'coord-quote-1', action, tracker, makeStager(executor)
    );
    const second = await service.submitIfCoordinatorQuoteMatches(
      quote(expiresAt), 'coord-quote-1', action, tracker, makeStager(executor)
    );

    expect(first.status).toBe('succeeded');
    expect(second.duplicate).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('records an amount mismatch and never submits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(coordinatorResponse({ amount: '999' })));
    const service = new QuoterService();
    const tracker = new RelaySubmissionTracker({ sleep: async () => undefined });
    const executor = vi.fn();

    await expect(service.submitIfCoordinatorQuoteMatches(
      quote(Date.now() + 30_000), 'coord-quote-1', action, tracker, makeStager(executor)
    )).rejects.toBeInstanceOf(RelayTerminalError);

    expect(executor).not.toHaveBeenCalled();
    expect(tracker.getRecord(action)?.lastError).toBe('COORDINATOR_QUOTE_MISMATCH');
    expect(tracker.getRecord(action)?.attempts).toBe(1);
  });

  it.each([
    ['from asset', { fromAsset: '0xother' }],
    ['to asset', { toAsset: 'OTHER' }],
    ['source network', { fromNetwork: 'other-chain' }],
    ['destination network', { toNetwork: 'other-chain' }],
  ])('refuses a differing %s without submitting', async (_field, mismatch) => {
    const expiresAt = Date.now() + 30_000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(coordinatorResponse({ expiresAt, ...mismatch })));
    const service = new QuoterService();
    const tracker = new RelaySubmissionTracker({ sleep: async () => undefined });
    const executor = vi.fn();

    await expect(service.submitIfCoordinatorQuoteMatches(
      quote(expiresAt), 'coord-quote-1', action, tracker, makeStager(executor)
    )).rejects.toBeInstanceOf(RelayTerminalError);

    expect(executor).not.toHaveBeenCalled();
    expect(tracker.getRecord(action)?.lastError).toBe('COORDINATOR_QUOTE_MISMATCH');
  });

  it('refuses a different expiry without submitting', async () => {
    const localExpiry = Date.now() + 30_000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      coordinatorResponse({ expiresAt: localExpiry + 1 })
    ));
    const service = new QuoterService();
    const tracker = new RelaySubmissionTracker({ sleep: async () => undefined });
    const executor = vi.fn();

    await expect(service.submitIfCoordinatorQuoteMatches(
      quote(localExpiry), 'coord-quote-1', action, tracker, makeStager(executor)
    )).rejects.toBeInstanceOf(RelayTerminalError);

    expect(executor).not.toHaveBeenCalled();
    expect(tracker.getRecord(action)?.lastError).toBe('COORDINATOR_QUOTE_MISMATCH');
  });

  it('records an expired quote and never submits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        fresh: false,
        expiresAt: Date.now() - 1,
      }), { status: 410, headers: { 'content-type': 'application/json' } })
    ));
    const service = new QuoterService();
    const tracker = new RelaySubmissionTracker({ sleep: async () => undefined });
    const executor = vi.fn();

    await expect(service.submitIfCoordinatorQuoteMatches(
      quote(Date.now() + 30_000), 'coord-quote-1', action, tracker, makeStager(executor)
    )).rejects.toBeInstanceOf(RelayTerminalError);

    expect(executor).not.toHaveBeenCalled();
    expect(tracker.getRecord(action)?.lastError).toBe('COORDINATOR_QUOTE_EXPIRED');
    expect(tracker.getRecord(action)?.attempts).toBe(1);
  });
});