import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useOrderRecovery } from '../lib/useOrderRecovery';

describe('useOrderRecovery Hook', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty state', () => {
    const { result } = renderHook(() =>
      useOrderRecovery({
        apiBase: 'http://localhost:8000',
        enabled: false,
      })
    );

    expect(result.current.recovered).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should fetch orders when addresses are provided', async () => {
    const mockOrders = {
      transactions: [
        {
          publicId: 'order-1',
          direction: 'eth_to_xlm',
          status: 'src_locked',
          hashlock: '0xabcd',
          src: {
            chain: 'ethereum',
            address: '0x123',
            asset: 'ETH',
            amount: '1',
            orderId: '1',
            lockTx: '0xtx1',
            timelock: 1000,
          },
          dst: {
            chain: 'stellar',
            address: 'GTEST',
            asset: 'XLM',
            amount: '5',
          },
        },
      ],
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockOrders,
    });

    const { result } = renderHook(() =>
      useOrderRecovery({
        ethAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        apiBase: 'http://localhost:8000',
      })
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recovered).toHaveLength(1);
    expect(result.current.recovered[0].id).toBe('order-1');
    expect(result.current.error).toBeNull();
  });

  it('should handle coordinator errors gracefully', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() =>
      useOrderRecovery({
        ethAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        apiBase: 'http://localhost:8000',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recovered).toHaveLength(0);
    expect(result.current.error).toBeNull(); // Error is logged but hook returns empty
  });

  it('should have refetch function to manually trigger recovery', async () => {
    const mockOrders = {
      transactions: [
        {
          publicId: 'order-1',
          direction: 'eth_to_xlm',
          status: 'src_locked',
          hashlock: '0xabcd',
          src: {
            chain: 'ethereum',
            address: '0x123',
            asset: 'ETH',
            amount: '1',
            orderId: '1',
            lockTx: '0xtx1',
            timelock: 1000,
          },
          dst: {
            chain: 'stellar',
            address: 'GTEST',
            asset: 'XLM',
            amount: '5',
          },
        },
      ],
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockOrders,
    });

    const { result } = renderHook(() =>
      useOrderRecovery({
        ethAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        apiBase: 'http://localhost:8000',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.recovered).toHaveLength(1);

    // Call refetch
    await result.current.refetch();

    expect(global.fetch).toHaveBeenCalledTimes(2); // Initial fetch + refetch
  });

  it('should not fetch when disabled', async () => {
    const { result } = renderHook(() =>
      useOrderRecovery({
        ethAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
        apiBase: 'http://localhost:8000',
        enabled: false,
      })
    );

    expect(result.current.recovered).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should not fetch when no addresses provided', () => {
    const { result } = renderHook(() =>
      useOrderRecovery({
        apiBase: 'http://localhost:8000',
      })
    );

    expect(result.current.recovered).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
