import { describe, test, expect } from 'vitest';
import {
  classifyOrderFreshness,
  FRESH_THRESHOLD_MS,
  PENDING_THRESHOLD_MS,
  STALE_THRESHOLD_MS,
  REFUND_SOON_WINDOW_MS,
  type OrderFreshnessInput,
} from './orderFreshness';

// ─── Fixed reference point ───────────────────────────────────────────────────
const NOW = 1_700_000_000_000; // arbitrary fixed "now" in ms

function make(overrides: Partial<OrderFreshnessInput>): OrderFreshnessInput {
  return {
    status: 'pending',
    updatedAt: NOW - 1_000, // 1 s ago by default
    nowMs: NOW,
    ...overrides,
  };
}

// ─── Terminal statuses ───────────────────────────────────────────────────────

describe('terminal statuses → always fresh', () => {
  const terminals = ['completed', 'refunded', 'failed', 'cancelled'];

  for (const status of terminals) {
    test(`${status} returns "fresh" even when very old`, () => {
      const result = classifyOrderFreshness(
        make({ status, updatedAt: NOW - STALE_THRESHOLD_MS * 10 })
      );
      expect(result.label).toBe('fresh');
      expect(result.hint).toBe('');
    });
  }
});

// ─── Age-based thresholds ────────────────────────────────────────────────────

describe('age-based freshness classification', () => {
  test('returns "fresh" when order is very new', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - 30_000 }) // 30 s ago
    );
    expect(result.label).toBe('fresh');
  });

  test('returns "fresh" just below FRESH_THRESHOLD_MS', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - (FRESH_THRESHOLD_MS - 1) })
    );
    expect(result.label).toBe('fresh');
  });

  test('returns "pending" just at FRESH_THRESHOLD_MS', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - FRESH_THRESHOLD_MS })
    );
    expect(result.label).toBe('pending');
    expect(result.hint).toMatch(/cross-chain swaps can take/i);
  });

  test('returns "pending" just below PENDING_THRESHOLD_MS', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - (PENDING_THRESHOLD_MS - 1) })
    );
    expect(result.label).toBe('pending');
  });

  test('returns "stale" just at PENDING_THRESHOLD_MS', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - PENDING_THRESHOLD_MS })
    );
    expect(result.label).toBe('stale');
    expect(result.hint).toMatch(/longer than expected/i);
  });

  test('returns "stale" well beyond STALE_THRESHOLD_MS', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - STALE_THRESHOLD_MS * 3 })
    );
    expect(result.label).toBe('stale');
    expect(result.hint).toMatch(/pending for a while/i);
  });
});

// ─── Timelock / refund logic ─────────────────────────────────────────────────

describe('timelock classification', () => {
  const ONE_HOUR_S = 3600;

  test('returns "refund-eligible" when timelock has expired', () => {
    const expiredTimelock = Math.floor((NOW - 60_000) / 1_000); // expired 1 min ago
    const result = classifyOrderFreshness(
      make({ timelockUnixSeconds: expiredTimelock })
    );
    expect(result.label).toBe('refund-eligible');
    expect(result.hint).toMatch(/can request a refund/i);
  });

  test('returns "refund-soon" when timelock expires within warning window', () => {
    const soonExpiry = Math.floor((NOW + REFUND_SOON_WINDOW_MS - 30_000) / 1_000); // 30 s inside window
    const result = classifyOrderFreshness(
      make({ timelockUnixSeconds: soonExpiry })
    );
    expect(result.label).toBe('refund-soon');
    expect(result.hint).toMatch(/expires in/i);
  });

  test('"refund-soon" hint includes approximate minutes remaining', () => {
    const tenMinutes = Math.floor((NOW + 10 * 60_000) / 1_000);
    const result = classifyOrderFreshness(
      make({ timelockUnixSeconds: tenMinutes })
    );
    expect(result.label).toBe('refund-soon');
    // Should say "~10 min" or similar
    expect(result.hint).toMatch(/10 min/i);
  });

  test('returns age-based label when timelock is far in future', () => {
    const farFuture = Math.floor((NOW + ONE_HOUR_S * 2 * 1_000) / 1_000);
    // Order is fresh (1 s old), timelock is 2 h away
    const result = classifyOrderFreshness(
      make({ timelockUnixSeconds: farFuture })
    );
    expect(result.label).toBe('fresh');
  });

  test('refund-eligible takes priority over stale age', () => {
    // Even if the order is very old AND eligible for refund, refund-eligible wins
    const expiredTimelock = Math.floor((NOW - 60_000) / 1_000);
    const result = classifyOrderFreshness(
      make({
        updatedAt: NOW - STALE_THRESHOLD_MS * 5,
        timelockUnixSeconds: expiredTimelock,
      })
    );
    expect(result.label).toBe('refund-eligible');
  });

  test('no timelockUnixSeconds → falls back to age-based only', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - STALE_THRESHOLD_MS * 2 })
    );
    expect(result.label).toBe('stale');
  });
});

// ─── Coordinator statuses ────────────────────────────────────────────────────

describe('coordinator-native statuses', () => {
  test('src_locked treated as active (not terminal)', () => {
    const result = classifyOrderFreshness(
      make({ status: 'src_locked', updatedAt: NOW - STALE_THRESHOLD_MS * 2 })
    );
    expect(result.label).toBe('stale');
  });

  test('dst_locked treated as active (not terminal)', () => {
    const result = classifyOrderFreshness(
      make({ status: 'dst_locked', updatedAt: NOW - PENDING_THRESHOLD_MS })
    );
    expect(result.label).toBe('stale');
  });

  test('announced treated as active', () => {
    const result = classifyOrderFreshness(
      make({ status: 'announced', updatedAt: NOW - FRESH_THRESHOLD_MS })
    );
    expect(result.label).toBe('pending');
  });

  test('secret_revealed treated as active', () => {
    const result = classifyOrderFreshness(
      make({ status: 'secret_revealed', updatedAt: NOW - STALE_THRESHOLD_MS * 2 })
    );
    expect(result.label).toBe('stale');
  });
});

// ─── Hint content guardrails ─────────────────────────────────────────────────

describe('hint content guardrails', () => {
  test('"fresh" hint is always an empty string', () => {
    expect(classifyOrderFreshness(make({})).hint).toBe('');
  });

  test('no hint uses alarming language for "pending"', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - FRESH_THRESHOLD_MS })
    );
    expect(result.hint).not.toMatch(/error|fail|danger|alert/i);
  });

  test('no hint uses alarming language for "stale"', () => {
    const result = classifyOrderFreshness(
      make({ updatedAt: NOW - STALE_THRESHOLD_MS * 2 })
    );
    expect(result.hint).not.toMatch(/error|fail|danger|alert/i);
  });
});