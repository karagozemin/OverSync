import { useEffect, useState } from 'react';
import { fetchOrderById, type RecoveredOrder } from '../lib/orderRecovery';

export function useOrder(orderId: string) {
  const [result, setResult] = useState<{
    id: string;
    order: RecoveredOrder | null;
    error: unknown;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const poll = async () => {
      try {
        const order = await fetchOrderById(orderId, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ id: orderId, order, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ id: orderId, order: null, error });
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 5_000);
    };
    let timer: number | undefined;
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [orderId]);

  return result?.id === orderId ? result : { order: null, error: null };
}
