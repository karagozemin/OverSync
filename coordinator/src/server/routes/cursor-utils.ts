/**
 * The one and only pagination codec for `GET /api/orders/history`.
 *
 * The coordinator mints and validates cursors. The frontend treats the value
 * as opaque and only ever echoes back what this module produced. That is the
 * whole point: if the history component and the query layer each decide what
 * "the next page" is, an off-by-one hides a fill or renders it twice.
 *
 * A cursor is a keyset, not an offset. It names the exact last row of the
 * previous page, so a row inserted between two requests can never shift the
 * window the way `OFFSET` does.
 */

export const CURSOR_VERSION = 1;

/** Cap the encoded token before allocating a decoded buffer or parsing JSON. */
export const MAX_HISTORY_CURSOR_LENGTH = 512;

/** `public_id` is 16 random bytes rendered as lowercase hex. */
const PUBLIC_ID = /^[0-9a-f]{32}$/;

const NETWORK = /^(testnet|mainnet)$/;

export interface HistoryCursor {
  /** Unix seconds of the last row on the previous page. */
  createdAt: number;
  /** `public_id` of that same row — the tiebreaker within `createdAt`. */
  publicId: string;
  /** The address this page of history belongs to. */
  user: string;
  /** The network this page of history belongs to. */
  network: string;
}

/** The request a cursor is being checked against. */
export interface CursorScope {
  user: string;
  network: string;
}

export type CursorRejection =
  | "malformed"
  | "unsupported_version"
  | "user_mismatch"
  | "network_mismatch";

export type CursorValidation =
  | { ok: true; cursor: HistoryCursor }
  | { ok: false; reason: CursorRejection; message: string };

/** Addresses are compared case-insensitively (Stellar keys are uppercase). */
function normaliseUser(user: string): string {
  return user.trim().toLowerCase();
}

function normaliseNetwork(network: string): string {
  return network.trim().toLowerCase();
}

/**
 * Serialise a keyset into the opaque token handed to clients.
 *
 * `base64url` keeps the token URL-safe without percent-encoding, so the
 * frontend can drop it straight into a `URLSearchParams`.
 */
export function encodeHistoryCursor(cursor: HistoryCursor): string {
  const payload = {
    v: CURSOR_VERSION,
    c: Math.trunc(cursor.createdAt),
    p: cursor.publicId.toLowerCase(),
    u: normaliseUser(cursor.user),
    n: normaliseNetwork(cursor.network)
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/**
 * Parse an opaque token back into a keyset, or `null` if it is not a cursor
 * this coordinator ever issued. Never throws.
 */
export function decodeHistoryCursor(raw: unknown): HistoryCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_HISTORY_CURSOR_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { v, c, p, u, n } = parsed as Record<string, unknown>;
  if (v !== CURSOR_VERSION) return null;
  if (typeof c !== "number" || !Number.isInteger(c) || c < 0) return null;
  if (typeof p !== "string" || !PUBLIC_ID.test(p)) return null;
  if (typeof u !== "string" || u.length === 0) return null;
  if (typeof n !== "string" || !NETWORK.test(n)) return null;

  return { createdAt: c, publicId: p, user: u, network: n };
}

/**
 * Decode a cursor *and* check it against the request it was sent with.
 *
 * A cursor is only meaningful to the user and the network it was minted for.
 * Replaying someone else's cursor would page through their orders, and
 * replaying a testnet cursor against mainnet would silently skip a page.
 */
export function validateHistoryCursor(raw: unknown, scope: CursorScope): CursorValidation {
  const cursor = decodeHistoryCursor(raw);
  if (!cursor) {
    return {
      ok: false,
      reason: "malformed",
      message: "Cursor is not a valid pagination token"
    };
  }
  if (cursor.network !== normaliseNetwork(scope.network)) {
    return {
      ok: false,
      reason: "network_mismatch",
      message: "Cursor was issued for a different network"
    };
  }
  if (cursor.user !== normaliseUser(scope.user)) {
    return {
      ok: false,
      reason: "user_mismatch",
      message: "Cursor was issued for a different user"
    };
  }
  return { ok: true, cursor };
}

export function validateCursor(cursor: { offset: number; createdAt: number }): boolean {
  if (typeof cursor.offset !== "number" || typeof cursor.createdAt !== "number") return false;
  if (isNaN(cursor.offset) || isNaN(cursor.createdAt)) return false;
  if (cursor.offset < 0) return false;
  return true;
}