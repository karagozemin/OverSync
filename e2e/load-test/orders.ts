/**
 * Deterministic order generator.
 *
 * All orders are derived from (seed, index) using sha256 so the same seed
 * always produces the same sequence. No RNG state, no side effects.
 */
import { createHash } from "node:crypto";

export type Hex = `0x${string}`;
export type Direction = "ETH_TO_XLM" | "XLM_TO_ETH";
export type ResolverAction = "fill" | "timeout";

export interface PlannedOrder {
  index: number;
  /** Short deterministic hex tag used in logs and reports (not an on-chain ID). */
  orderId: string;
  preimage: Hex;
  /** sha256(preimage) — the hashlock used by both HTLC implementations. */
  hashlock: Hex;
  direction: Direction;
  /** Notional ETH amount in wei (informational only in dry-run). */
  amountWei: bigint;
  /**
   * Planned resolver action:
   *   fill    — resolver claims before timelock (≈80 % of orders)
   *   timeout — resolver withholds; both sides refund after timelock (≈20 %)
   */
  resolverAction: ResolverAction;
  timelockSeconds: number;
}

// Derives a deterministic 32-byte buffer for a given (seed, role, index) triple.
function deterministicBytes(seed: string, role: string, index: number): Buffer {
  return createHash("sha256")
    .update(`${seed}:${role}:${index}`)
    .digest();
}

// Returns the first byte (0–255) derived from a given slot — cheap coin flip.
function slotByte(seed: string, role: string, index: number): number {
  return deterministicBytes(seed, role, index)[0];
}

export function generateOrders(
  seed: string,
  count: number,
  timelockSeconds: number
): PlannedOrder[] {
  const orders: PlannedOrder[] = [];

  for (let i = 0; i < count; i++) {
    // Preimage: sha256(seed:preimage:i)
    const preimageBytes = deterministicBytes(seed, "preimage", i);
    const preimage: Hex = `0x${preimageBytes.toString("hex")}`;

    // Hashlock: sha256(preimage) — mirrors what both HTLC contracts enforce.
    const hashlockBytes = createHash("sha256").update(preimageBytes).digest();
    const hashlock: Hex = `0x${hashlockBytes.toString("hex")}`;

    // Short order tag for human-readable output (first 8 bytes of the hashlock).
    const orderId = `0x${hashlockBytes.toString("hex").slice(0, 16)}`;

    // Direction: 50/50 split.
    const direction: Direction =
      slotByte(seed, "direction", i) < 128 ? "ETH_TO_XLM" : "XLM_TO_ETH";

    // Resolver action: ~80 % fill, ~20 % timeout.
    const resolverAction: ResolverAction =
      slotByte(seed, "action", i) < 205 ? "fill" : "timeout";

    // Notional amount: 0.001–0.09 ETH expressed in wei (informational).
    const amountByte = slotByte(seed, "amount", i);
    const amountWei =
      BigInt(1_000_000_000_000_000) +
      BigInt(amountByte) * BigInt(345_098_039_000_000);

    orders.push({
      index: i,
      orderId,
      preimage,
      hashlock,
      direction,
      amountWei,
      resolverAction,
      timelockSeconds,
    });
  }

  return orders;
}
