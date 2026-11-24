import type { IncomingHttpHeaders } from "node:http";
import type { Socket } from "node:net";

export interface ClientIpRequest {
  headers: IncomingHttpHeaders;
  socket?: Pick<Socket, "remoteAddress">;
}

/**
 * Parse COORDINATOR_TRUSTED_PROXY.
 *
 * - unset / false / 0 / no / off → 0 hops (ignore forwarding headers)
 * - true / yes / on → 1 hop
 * - positive integer N → trust N hops from the right of the chain
 */
export function parseTrustedProxySetting(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return 0;
  const value = String(raw).trim().toLowerCase();
  if (!value || value === "false" || value === "0" || value === "no" || value === "off") {
    return 0;
  }
  if (value === "true" || value === "yes" || value === "on") {
    return 1;
  }
  const hops = Number(value);
  if (Number.isInteger(hops) && hops > 0) {
    return hops;
  }
  return 0;
}

/**
 * Canonicalize an address so equivalent forms share one rate-limit bucket.
 * Strips quotes, brackets, trailing ports, and IPv4-mapped IPv6 prefixes.
 */
export function normalizeIp(raw: string): string {
  let value = raw.trim();
  if (!value) return "unknown";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end !== -1) {
      value = value.slice(1, end);
    }
  } else {
    // IPv4host:port — avoid slicing IPv6 which also contains colons.
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    if (firstColon !== -1 && firstColon === lastColon && value.includes(".")) {
      value = value.slice(0, firstColon);
    }
  }

  const lower = value.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    value = value.slice("::ffff:".length);
  }

  value = value.trim().toLowerCase();
  return value || "unknown";
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) {
    return raw.find((entry) => entry.trim().length > 0);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw;
  }
  return undefined;
}

function parseXForwardedFor(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Extract `for=` addresses from an RFC 7239 Forwarded header.
 * Example: `for=192.0.2.60;proto=http, for="[2001:db8::1]:4711"`
 */
function parseForwardedFor(value: string): string[] {
  const addresses: string[] = [];
  for (const segment of value.split(",")) {
    for (const param of segment.split(";")) {
      const trimmed = param.trim();
      const match = /^for\s*=\s*(.+)$/i.exec(trimmed);
      if (!match) continue;
      let candidate = match[1]!.trim();
      if (
        (candidate.startsWith('"') && candidate.endsWith('"')) ||
        (candidate.startsWith("'") && candidate.endsWith("'"))
      ) {
        candidate = candidate.slice(1, -1);
      }
      if (candidate) addresses.push(candidate);
    }
  }
  return addresses;
}

/**
 * Resolve the client IP used for rate limiting.
 *
 * By default Forwarded / X-Forwarded-For are ignored so public callers cannot
 * pick their own bucket. When `trustedProxyHops` is positive, the address
 * `hops` entries from the right of the forwarding chain is used (Reflex /
 * Express-style hop counting). Falls back to the socket peer when the chain
 * is shorter than the configured hop count.
 */
export function resolveClientIp(
  req: ClientIpRequest,
  options: { trustedProxyHops?: number } = {}
): string {
  const hops = Math.max(0, Math.floor(options.trustedProxyHops ?? 0));
  const peer = normalizeIp(req.socket?.remoteAddress ?? "unknown");

  if (hops === 0) {
    return peer;
  }

  const xff = readHeader(req.headers, "x-forwarded-for");
  const forwarded = readHeader(req.headers, "forwarded");
  const chain = xff
    ? parseXForwardedFor(xff)
    : forwarded
      ? parseForwardedFor(forwarded)
      : [];

  if (chain.length >= hops) {
    return normalizeIp(chain[chain.length - hops]!);
  }

  return peer;
}
