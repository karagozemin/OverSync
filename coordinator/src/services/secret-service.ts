import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { keccak256, toHex } from "viem";
import type { OrderService } from "./order-service.js";

function bufferFromHex(s: string): Buffer {
  return Buffer.from(s.startsWith("0x") ? s.slice(2) : s, "hex");
}

function sha256Hex(buf: Buffer): string {
  return "0x" + createHash("sha256").update(buf).digest("hex");
}

function keccak256Hex(buf: Buffer): string {
  return keccak256(toHex(buf)) as `0x${string}`;
}

/**
 * Coordinates secret reveal between the two chains.
 *
 * The coordinator never holds funds, so revealing a secret to it cannot
 * cause loss of user funds — at worst the coordinator could withhold
 * the secret, in which case the user can retrieve it themselves
 * directly from the on-chain `OrderClaimed` event on whichever side
 * settled first.
 */
export class SecretService {
  constructor(
    private readonly orders: OrderService,
    private readonly log: Logger
  ) {}

  /**
   * Record a preimage revealed by a resolver or by the user. The
   * coordinator verifies the preimage hashes to the order's hashlock
   * before storing it, so a malicious caller cannot poison the cache.
   */
  async reveal(publicId: string, preimage: string, txHash: string): Promise<{ ok: true }> {
    const order = await this.orders.get(publicId);
    if (!order) {
      throw new Error(`unknown order ${publicId}`);
    }
    const buf = bufferFromHex(preimage);
    const shaHash = sha256Hex(buf);
    const kekHash = keccak256Hex(buf);
    if (shaHash !== order.hashlock && kekHash !== order.hashlock) {
      this.log.warn(
        { publicId, expected: order.hashlock, sha: shaHash, kek: kekHash },
        "rejected preimage with mismatching hash"
      );
      throw new Error("preimage does not match order hashlock");
    }
    await this.orders.recordSecret(publicId, preimage, txHash);
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
