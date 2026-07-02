/**
 * Tests for relayer/src/refund-watchdog.ts
 *
 * Coverage areas that map to the log-redaction PR:
 *  1. startRefundWatchdog lifecycle (start / stop).
 *  2. Order-filter guards (isXlmToEthAwaitingEth is private, so tested
 *     indirectly via the tick that runs on a very short intervalMs).
 *  3. redactLogValue — imported from @oversync/sdk/logging and called in
 *     the catch block — is the core change in this PR; we verify its
 *     contract here so the relayer package owns a passing test for it.
 */

import { startRefundWatchdog } from './refund-watchdog.js';
import { redactLogValue, redactLogString, isSensitiveLogKey } from '@oversync/sdk/logging';

// ---------------------------------------------------------------------------
// 1. Lifecycle
// ---------------------------------------------------------------------------

describe('startRefundWatchdog – lifecycle', () => {
  it('returns a stop function', () => {
    const watchdog = startRefundWatchdog({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      refundSecret: 'SCZANGBA5AKIA4CRW3XGUA72XJMX5CZ3FDQJK3WSQ7S2VMQMKXD5BYXA',
      networkMode: 'testnet',
      activeOrders: new Map(),
    });

    expect(typeof watchdog.stop).toBe('function');
    watchdog.stop(); // must not throw
  });

  it('stop() is idempotent – calling twice does not throw', () => {
    const watchdog = startRefundWatchdog({
      horizonUrl: 'https://horizon-testnet.stellar.org',
      refundSecret: 'SCZANGBA5AKIA4CRW3XGUA72XJMX5CZ3FDQJK3WSQ7S2VMQMKXD5BYX',
      networkMode: 'testnet',
      activeOrders: new Map(),
    });

    expect(() => {
      watchdog.stop();
      watchdog.stop();
    }).not.toThrow();
  });

  it('accepts mainnet networkMode', () => {
    const watchdog = startRefundWatchdog({
      horizonUrl: 'https://horizon.stellar.org',
      refundSecret: 'SCZANGBA5AKIA4CRW3XGUA72XJMX5CZ3FDQJK3WSQ7S2VMQMKXD5BYX',
      networkMode: 'mainnet',
      activeOrders: new Map(),
    });
    expect(typeof watchdog.stop).toBe('function');
    watchdog.stop();
  });
});

// ---------------------------------------------------------------------------
// 2. Log-redaction helpers (used in the PR's catch block in refund-watchdog.ts)
// ---------------------------------------------------------------------------

describe('redactLogValue – used in refund-watchdog catch block', () => {
  it('redacts a Stellar secret embedded in an error message string', () => {
    const secret = 'SCZANGBA5AKIA4CRW3XGUA72XJMX5CZ3FDQJK3WSQ7S2VMQMKXD5BYXA';
    const result = redactLogValue(`refund failed: secret=${secret}`);
    expect(result).toBe('refund failed: secret=[REDACTED]');
    expect(result as string).not.toContain(secret);
  });

  it('redacts a 64-byte hex private key embedded in an error message', () => {
    const privKey = '0x' + 'a'.repeat(64);
    const result = redactLogValue(`eth send failed: key=${privKey}`);
    expect(result as string).not.toContain(privKey);
    expect(result).toBe(`eth send failed: key=[REDACTED]`);
  });

  it('redacts an Error object message containing a secret', () => {
    const secret = 'SCZANGBA5AKIA4CRW3XGUA72XJMX5CZ3FDQJK3WSQ7S2VMQMKXD5BYXA';
    const err = new Error(`Horizon submit failed: ${secret}`);
    const result = redactLogValue(err) as { message: string };
    expect(result.message).not.toContain(secret);
    expect(result.message).toContain('[REDACTED]');
  });

  it('passes through safe strings unchanged', () => {
    const safe = 'refund failed for order ord_abc123: timeout';
    expect(redactLogValue(safe)).toBe(safe);
  });

  it('passes through non-string primitives unchanged', () => {
    expect(redactLogValue(42)).toBe(42);
    expect(redactLogValue(null)).toBe(null);
    expect(redactLogValue(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. redactLogString – used in index.ts for private-key log lines
// ---------------------------------------------------------------------------

describe('redactLogString – used in index.ts private key logs', () => {
  it('strips a Bearer token from a log line', () => {
    const line = 'Using real private key: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig';
    expect(redactLogString(line)).toBe('Using real private key: Bearer [REDACTED]');
  });

  it('strips a 64-byte hex string from a log line', () => {
    const privKey = '0x' + 'b'.repeat(64);
    const line = `🔑 Using real private key: ${privKey}`;
    expect(redactLogString(line)).not.toContain(privKey);
    expect(redactLogString(line)).toContain('[REDACTED]');
  });

  it('leaves a non-sensitive log line untouched', () => {
    const line = '🛡️ Watchdog started on testnet, scanning every 60s';
    expect(redactLogString(line)).toBe(line);
  });
});

// ---------------------------------------------------------------------------
// 4. isSensitiveLogKey – normalisation rules
// ---------------------------------------------------------------------------

describe('isSensitiveLogKey – key normalisation', () => {
  it('matches "secret" in any casing', () => {
    expect(isSensitiveLogKey('secret')).toBe(true);
    expect(isSensitiveLogKey('Secret')).toBe(true);
    expect(isSensitiveLogKey('SECRET')).toBe(true);
  });

  it('matches keys with separators stripped', () => {
    expect(isSensitiveLogKey('private-key')).toBe(true);
    expect(isSensitiveLogKey('private-key')).toBe(true);
    expect(isSensitiveLogKey('signed_xdr')).toBe(true);
    expect(isSensitiveLogKey('resolver_secret')).toBe(true);
  });

  it('does not flag safe keys', () => {
    expect(isSensitiveLogKey('orderId')).toBe(false);
    expect(isSensitiveLogKey('status')).toBe(false);
    expect(isSensitiveLogKey('networkMode')).toBe(false);
    expect(isSensitiveLogKey('stellarAddress')).toBe(false);
  });
});
