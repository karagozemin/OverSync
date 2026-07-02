import { useState, useEffect, useCallback, useRef } from 'react';

export type BackendStatus = 'checking' | 'reachable' | 'unavailable' | 'degraded';

export interface BackendStatusState {
  status: BackendStatus;
  lastChecked: Date | null;
  errorMessage: string | null;
  retry: () => void;
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

  const check = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timerId = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

    setStatus('checking');

    try {
      const res = await fetch(`${getApiBase()}/health`, { signal: controller.signal });

      setLastChecked(new Date());

      if (!res.ok) {
        setStatus('unavailable');
        setErrorMessage(`Server responded with ${res.status}`);
        return;
      }

      const body: unknown = await res.json().catch(() => null);
      const isOk = typeof body === 'object' && body !== null && (body as Record<string, unknown>).status === 'ok';

      if (isOk) {
        setStatus('reachable');
        setErrorMessage(null);
      } else {
        setStatus('degraded');
        setErrorMessage('Coordinator returned an unexpected status');
      }
    } catch (err: unknown) {
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

  return { status, lastChecked, errorMessage, retry: check };
}
