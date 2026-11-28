import { useState, useEffect, useCallback, useRef } from 'react';

export type BackendStatus =
  | 'checking'
  | 'reachable'
  | 'unavailable'
  | 'degraded'
  // Readiness aliases consumed by the bridge form guardrails.
  | 'ready'
  | 'not-ready'
  | 'loading'
  | 'down';

export interface BackendStatusState {
  status: BackendStatus;
  /** True once the coordinator answered a healthy status. */
  isReady: boolean;
  /** True while a health check is in flight. */
  isLoading: boolean;
  /** Alias of `isLoading`, kept for the bridge form guardrails. */
  loading: boolean;
  lastChecked: Date | null;
  errorMessage: string | null;
  /** Alias of `errorMessage`, kept for the bridge form guardrails. */
  error: string | null;
  retry: () => void;
  /** Alias of `retry`, kept for the bridge form guardrails. */
  refresh: () => void;
}

const POLL_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 5_000;

function getApiBase(): string {
  return import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '');
}

export function useBackendStatus(): BackendStatusState {
  const [status, setStatus] = useState<BackendStatus>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const check = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    const timerId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    setStatus('checking');

    try {
      const res = await fetch(`${getApiBase()}/health`, { signal: controller.signal });

      if (requestId !== requestIdRef.current) return;

      setLastChecked(new Date());

      if (!res.ok) {
        setStatus('unavailable');
        setErrorMessage(`Server responded with ${res.status}`);
        return;
      }

      const body: unknown = await res.json().catch(() => null);

      if (requestId !== requestIdRef.current) return;

      const isOk = typeof body === 'object' && body !== null && (body as Record<string, unknown>).status === 'ok';

      if (isOk) {
        setStatus('reachable');
        setErrorMessage(null);
      } else {
        setStatus('degraded');
        setErrorMessage('Coordinator returned an unexpected status');
      }
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      setLastChecked(new Date());
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      setStatus('unavailable');
      setErrorMessage(isTimeout ? 'Connection timed out' : 'Cannot reach coordinator');
    } finally {
      window.clearTimeout(timerId);
    }
  }, []);

  useEffect(() => {
    check();
    const id = window.setInterval(check, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      abortRef.current?.abort();
    };
  }, [check]);

  return {
    status,
    isReady: status === 'reachable',
    isLoading: status === 'checking',
    loading: status === 'checking',
    lastChecked,
    errorMessage,
    error: errorMessage,
    retry: check,
    refresh: check,
  };
}
