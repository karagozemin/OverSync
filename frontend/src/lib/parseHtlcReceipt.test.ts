import { describe, test, expect } from 'vitest';
import {
  parseHtlcReceipt,
  parseHtlcClaim,
  preimageMatchesHashlock,
  receiptMatchesOrder,
  normaliseHex32,
} from './parseHtlcReceipt';
import {
  v2OrderCreatedLog,
  v2OrderClaimedLog,
  v1OrderCreatedLog,
  v1OrderClaimedLog,
  truncatedLog,
  unrelatedTransferLog,
  receiptFromLogs,
  ORDER_HASHLOCK,
  ORDER_PREIMAGE,
  OTHER_HASHLOCK,
  OTHER_PREIMAGE,
  V2_ORDER_ID,
  V2_OTHER_ORDER_ID,
  V1_ORDER_ID,
  V1_OTHER_ORDER_ID,
  LOCK_AMOUNT_WEI,
  OTHER_AMOUNT_WEI,
  NATIVE_ETH,
  LOCK_TX_HASH,
  CLAIM_TX_HASH,
} from './htlc-receipt-fixtures';

describe('parseHtlcReceipt (shared fixtures, real ABI encoding)', () => {
  test('returns null for empty logs', () => {
    expect(parseHtlcReceipt([])).toBeNull();
    expect(parseHtlcReceipt(null)).toBeNull();
    expect(parseHtlcReceipt(undefined)).toBeNull();
  });

  test('ignores a truncated log instead of throwing a raw hex dump', () => {
    const logs = [truncatedLog()];
    expect(() => parseHtlcReceipt(logs)).not.toThrow();
    expect(parseHtlcReceipt(logs)).toBeNull();
  });

  test('ignores a receipt whose only log is an unrelated Transfer', () => {
    expect(parseHtlcReceipt([unrelatedTransferLog()])).toBeNull();
  });

  test('parses v2 HTLCEscrow OrderCreated with hashlock and token', () => {
    const parsed = parseHtlcReceipt([v2OrderCreatedLog()]);

    expect(parsed).toEqual({
      contractMode: 'v2-escrow',
      contractAddress: '0xb352339beb146f2699d28d736700b953988bb178',
      orderId: V2_ORDER_ID,
      amountWei: LOCK_AMOUNT_WEI,
      timelockUnixSeconds: 1_700_000_000,
      hashlock: ORDER_HASHLOCK,
      token: NATIVE_ETH,
    });
  });

  test('parses v1 MainnetHTLC OrderCreated when v2 does not decode', () => {
    const parsed = parseHtlcReceipt([v1OrderCreatedLog()]);

    expect(parsed).toEqual({
      contractMode: 'v1-mainnet-htlc',
      contractAddress: '0x7d9ce70aa40e144e8bbe266a0dc3b3f91b6d1d99',
      orderId: V1_ORDER_ID,
      amountWei: LOCK_AMOUNT_WEI,
      timelockUnixSeconds: 1_700_000_000,
      hashlock: ORDER_HASHLOCK,
      token: NATIVE_ETH,
    });
  });
});

describe('parseHtlcClaim', () => {
  test('extracts order id, preimage, and claim tx hash from a v2 claim log', () => {
    const claim = parseHtlcClaim([v2OrderClaimedLog()]);

    expect(claim).toEqual({
      contractMode: 'v2-escrow',
      contractAddress: '0xb352339beb146f2699d28d736700b953988bb178',
      orderId: V2_ORDER_ID,
      preimage: ORDER_PREIMAGE,
      claimTxHash: CLAIM_TX_HASH,
    });
  });

  test('extracts a v1 claim log', () => {
    const claim = parseHtlcClaim([v1OrderClaimedLog()]);

    expect(claim).toEqual({
      contractMode: 'v1-mainnet-htlc',
      contractAddress: '0x7d9ce70aa40e144e8bbe266a0dc3b3f91b6d1d99',
      orderId: V1_ORDER_ID,
      preimage: ORDER_PREIMAGE,
      claimTxHash: CLAIM_TX_HASH,
    });
  });

  test('returns null for a truncated claim log', () => {
    expect(() => parseHtlcClaim([truncatedLog()])).not.toThrow();
    expect(parseHtlcClaim([truncatedLog()])).toBeNull();
  });
});

describe('preimageMatchesHashlock', () => {
  test('accepts the preimage that hashes to the order hashlock', () => {
    expect(preimageMatchesHashlock(ORDER_PREIMAGE, ORDER_HASHLOCK)).toBe(true);
  });

  test('rejects a foreign preimage', () => {
    expect(preimageMatchesHashlock(OTHER_PREIMAGE, ORDER_HASHLOCK)).toBe(false);
    expect(preimageMatchesHashlock(ORDER_PREIMAGE, OTHER_HASHLOCK)).toBe(false);
  });

  test('rejects missing or malformed input without throwing', () => {
    expect(preimageMatchesHashlock(null, ORDER_HASHLOCK)).toBe(false);
    expect(preimageMatchesHashlock(ORDER_PREIMAGE, undefined)).toBe(false);
    expect(preimageMatchesHashlock('0xzz', ORDER_HASHLOCK)).toBe(false);
  });
});

describe('receiptMatchesOrder (issue #274 gate)', () => {
  const matchingOrder = {
    orderId: V2_ORDER_ID,
    hashlock: ORDER_HASHLOCK,
    amountWei: LOCK_AMOUNT_WEI,
    token: NATIVE_ETH,
  };

  test('accepts a receipt that matches hashlock, amount, asset, and order id', () => {
    const result = receiptMatchesOrder({
      receipt: {
        orderId: V2_ORDER_ID,
        hashlock: ORDER_HASHLOCK,
        amountWei: LOCK_AMOUNT_WEI,
        token: NATIVE_ETH,
      },
      order: matchingOrder,
    });
    expect(result.matched).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  test('rejects a receipt for a different order id', () => {
    const result = receiptMatchesOrder({
      receipt: { ...matchingOrder, orderId: V2_OTHER_ORDER_ID },
      order: matchingOrder,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatches).toEqual(['orderId']);
  });

  test('rejects a receipt with a different hashlock', () => {
    const result = receiptMatchesOrder({
      receipt: { ...matchingOrder, hashlock: OTHER_HASHLOCK },
      order: matchingOrder,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatches).toEqual(['hashlock']);
  });

  test('rejects a receipt with a different amount', () => {
    const result = receiptMatchesOrder({
      receipt: { ...matchingOrder, amountWei: OTHER_AMOUNT_WEI },
      order: matchingOrder,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatches).toEqual(['amount']);
  });

  test('rejects a receipt for a different asset', () => {
    const result = receiptMatchesOrder({
      receipt: { ...matchingOrder, token: '0x0000000000000000000000000000000000000001' },
      order: matchingOrder,
    });
    expect(result.matched).toBe(false);
    expect(result.mismatches).toEqual(['asset']);
  });

  test('rejects when a field is missing on either side', () => {
    expect(
      receiptMatchesOrder({ receipt: null, order: matchingOrder }).matched
    ).toBe(false);
    expect(
      receiptMatchesOrder({
        receipt: { orderId: V2_ORDER_ID, hashlock: ORDER_HASHLOCK, amountWei: LOCK_AMOUNT_WEI, token: NATIVE_ETH },
        order: { orderId: V2_ORDER_ID, hashlock: ORDER_HASHLOCK, amountWei: LOCK_AMOUNT_WEI },
      }).matched
    ).toBe(false);
  });

  test('normalises order id and hashlock formatting before comparing', () => {
    // v1-style ids arrive as bytes32 hex; a coordinator record might
    // carry them in a different case or width.
    const result = receiptMatchesOrder({
      receipt: {
        orderId: V1_ORDER_ID.replace('0x', '').toUpperCase(),
        hashlock: ORDER_HASHLOCK,
        amountWei: LOCK_AMOUNT_WEI,
        token: NATIVE_ETH,
      },
      order: { ...matchingOrder, orderId: V1_ORDER_ID },
    });
    expect(result.matched).toBe(true);
  });

  test('compares v1 decimal-free hex ids case-insensitively', () => {
    const result = receiptMatchesOrder({
      receipt: { ...matchingOrder, orderId: V1_ORDER_ID },
      order: { ...matchingOrder, orderId: V1_ORDER_ID.toUpperCase().replace('0X', '0x') },
    });
    expect(result.matched).toBe(true);
  });
});

describe('normaliseHex32', () => {
  test('pads short hex values to bytes32 width', () => {
    expect(normaliseHex32('0x1234')).toBe(`0x${'1234'.padStart(64, '0')}`);
  });

  test('lowercases input', () => {
    expect(normaliseHex32('0xABCDEF')).toBe(`0x${'abcdef'.padStart(64, '0')}`);
  });

  test('rejects non-hex and overlong values', () => {
    expect(normaliseHex32('0xzz')).toBeNull();
    expect(normaliseHex32(`0x${'a'.repeat(65)}`)).toBeNull();
    expect(normaliseHex32(null)).toBeNull();
  });
});
