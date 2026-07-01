/**
 * React hook for recovering orders from the coordinator API after wallet reconnection.
 *
 * Handles:
 * - Fetching pending/refundable swaps for connected addresses
 * - Deduplicating against local transaction history
 * - Graceful fallback to local state on coordinator unavailability
 */

import { useEffect, useCallback, useState } from 'react';
import {
  fetchRecoveredOrders,
  type TransactionFromCoordinator,
} from './orderRecovery';

export interface UseOrderRecoveryOptions {
  ethAddress?: string;
  stellarAddress?: string;
  apiBase: string;
  enabled?: boolean;
}

export interface UseOrderRecoveryResult {
  recovered: TransactionFromCoordinator[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to recover pending orders from the coordinator after wallet reconnection.
 *
 * Automatically fetches orders for the given Ethereum and Stellar addresses
 * when they become available. Returns recovered orders (before deduplication;
 * the component is responsible for merging with local history).
 *
 * @param options - Configuration for address(es) to fetch and API base URL
 * @returns Recovered orders, loading state, error, and refetch function
 */
export function useOrderRecovery(options: UseOrderRecoveryOptions): UseOrderRecoveryResult {
  const { ethAddress, stellarAddress, apiBase, enabled = true } = options;
  const [recovered, setRecovered] = useState<TransactionFromCoordinator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled || (!ethAddress && !stellarAddress)) {
      setRecovered([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const orders = await fetchRecoveredOrders(ethAddress, stellarAddress, apiBase);
      setRecovered(orders);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error recovering orders');
      setError(error);
      console.warn('Order recovery failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [ethAddress, stellarAddress, apiBase, enabled]);

  // Automatically refetch when addresses change
  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    recovered,
    isLoading,
    error,
    refetch,
  };
}
