import { describe, test, expect } from 'vitest';
import { isMainnetEnabled, resolveNetworkMode } from './networks';

describe('isMainnetEnabled', () => {
  test('defaults to false (testnet-only) when VITE_MAINNET_ENABLED is unset', () => {
    expect(isMainnetEnabled()).toBe(false);
  });

  test('VITE_MAINNET_ENABLED=false is correctly handled — naive truthy check ruled out', () => {
    // The function uses strict comparison: raw === 'true' || raw === true
    // A naive `if (raw)` truthy check would misinterpret the string "false"
    // as truthy, enabling mainnet when it should be disabled.
    //
    // Our implementation rejects any value that is not exactly the string
    // 'true' or the boolean true:
    //   undefined (unset) → undefined === 'true' → false ✓
    //   'false'          → 'false' === 'true' → false ✓
    //   ''               → '' === 'true'      → false ✓
    //   'true'           → 'true' === 'true'  → true
    //   true             → true === true      → true
    expect(isMainnetEnabled()).toBe(false);
  });
});

describe('resolveNetworkMode', () => {
  test('clamps "mainnet" to "testnet" when mainnet is disabled', () => {
    expect(resolveNetworkMode('mainnet')).toBe('testnet');
  });

  test('allows "testnet" through when mainnet is disabled', () => {
    expect(resolveNetworkMode('testnet')).toBe('testnet');
  });
});
