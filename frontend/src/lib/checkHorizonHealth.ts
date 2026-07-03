/**
 * Check if a Stellar Horizon RPC endpoint is reachable and responding.
 *
 * This is a read-only health check suitable for preflight validation.
 * Returns an object indicating reachability and response time.
 */

export interface HorizonHealthResult {
  reachable: boolean;
  responseTime?: number;
  error?: string;
  network?: string;
}

export async function checkHorizonHealth(
  horizonUrl: string,
  timeout: number = 5000
): Promise<HorizonHealthResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${horizonUrl}/health`, {
      signal: controller.signal,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        reachable: false,
        responseTime,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();

    return {
      reachable: true,
      responseTime,
      network: data.network || undefined,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      reachable: false,
      responseTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
