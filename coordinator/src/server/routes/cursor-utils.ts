/**
 * Cursor utilities for stable pagination.
 * Cursor = base64-encoded JSON of {offset, createdAt} for stable offset-based pagination.
 */

export interface CursorData {
  offset: number;
  createdAt: number;
}

/** Encode cursor to base64 string */
export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

/** Decode cursor from base64 string */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
