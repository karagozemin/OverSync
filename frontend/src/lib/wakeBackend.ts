/** Tell the relayer someone opened the app so chain pollers stay attentive. */
export function pingBackendWake(): void {
  const apiBase = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || '');
  fetch(`${apiBase}/api/health`, { method: 'GET', keepalive: true }).catch(() => {
    // Best-effort — site works without it; order creation also wakes pollers.
  });
}
