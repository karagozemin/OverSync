import type { Logger } from "pino";
import { assertValidSecretFormat, hashOrderPreimage } from "@oversync/sdk/secrets";
import type { OrderService } from "./order-service.js";
import { evaluateSecretWindow } from "../utils/timelock-validator.js";

/**
 * Coordinates secret reveal between the two chains.
 *
 * The coordinator never holds funds, so revealing a secret to it cannot
 * cause loss of user funds — at worst the coordinator could withhold
 * the secret, in which case the user can retrieve it themselves
 * directly from the on-chain `OrderClaimed` event on whichever side
 * settled first.
 *
 * The write path (#254) validates, in order: preimage format, hashlock
 * match, duplicate storage, then the timelock window. A secret is stored
 * at most once per order; re-relayed duplicates are a no-op that never
 * rewrites storage.
 */
export class SecretService {
  private readonly now: () => number;

  constructor(
    private readonly orders: OrderService,
    private readonly log: Logger,
    options: SecretServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Whether the order's reveal window is still open at the current time.
   * Delegates to the pure {@link evaluateSecretWindow} helper so the rule
   * is shared and testable without a service instance (#254).
   */
  private assertInsideTimelockWindow(
    srcTimelock: number | null | undefined,
    dstTimelock: number | null | undefined
  ): void {
    const nowSec = Math.floor(this.now() / 1000);
    const verdict = evaluateSecretWindow(srcTimelock, dstTimelock, nowSec);
    if (!verdict.open) {
      this.log.warn(
        { srcTimelock, dstTimelock, nowSec, reason: verdict.error },
        "rejected secret: timelock window closed"
      );
      throw new SecretExpiredError(
        verdict.error === "DST_TIMELOCK_EXPIRED"
          ? "the destination timelock window has expired"
          : "the source timelock window has expired"
      );
    }
  }

  /**
  * Record a preimage revealed by a resolver or by the user. The
  * coordinator verifies it against every known on-chain order ID before
  * storing it, so a malicious caller cannot poison the cache.
   */
  async reveal(publicId: string, preimage: string, txHash: string): Promise<{ ok: true }> {
    assertValidSecretFormat(preimage, "preimage");
    const canonical = preimage.toLowerCase() as `0x${string}`;
    const order = await this.orders.get(publicId);
    if (!order) {
      throw new Error(`unknown order ${publicId}`);
    }
    const orderIds = [order.srcOrderId, order.dstOrderId].filter(
      (orderId): orderId is string => orderId !== null
    );
    const matchesKnownOrders = orderIds.length > 0 && orderIds.every((orderId) => {
      if (!/^\d+$/.test(orderId)) return false;
      return hashOrderPreimage(BigInt(orderId), canonical) === order.hashlock;
    });
    if (!matchesKnownOrders) {
      this.log.warn(
        { publicId, expected: order.hashlock, orderIds },
        "rejected preimage with mismatching hash"
      );
      throw new Error("preimage does not match order hashlock");
    }

    // Duplicate relay of the same secret for the same order: storage must
    // not change (the first txHash stays), so return before the write.
    if (order.preimage != null) {
      if (order.preimage === canonical) {
        this.log.info({ publicId }, "duplicate secret relay ignored");
        return { ok: true };
      }
      this.log.warn({ publicId }, "rejected conflicting secret for order");
      throw new SecretConflictError();
    }

    // The same preimage bound to a different order is always rejected.
    const existing = await this.orders.findByPreimage(canonical);
    if (existing && existing.publicId !== publicId) {
      this.log.warn(
        { publicId, reusedBy: existing.publicId },
        "rejected reused preimage"
      );
      throw new Error("preimage already used in another order");
    }

    // Timelock gate on the write path: reject when either side's window
    // has closed, using the injectable clock (#254).
    this.assertInsideTimelockWindow(order.srcTimelock, order.dstTimelock);

    await this.orders.recordSecret(publicId, canonical, txHash);
    return { ok: true };
  }

  /**
   * Look up a previously revealed preimage. Returns null if not
   * revealed yet.
   */
  async get(publicId: string): Promise<string | null> {
    const order = await this.orders.get(publicId);
    return order?.preimage ?? null;
  }
}
