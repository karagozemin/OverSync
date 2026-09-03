import type { Logger } from "pino";
import { z } from "zod";
import { normalizeChainAddress, normalizeAddress } from "@oversync/sdk";
import {
  OrdersRepository,
  type OrderRow,
  type OrderSnapshot,
  type AnnounceOrderInput,
  type OrderMetrics,
  type OrderTransitionSummary,
  type Direction,
  type Chain
} from "../persistence/orders-repo.js";
import { canTransition } from "../state-machine/order-machine.js";
import { ordersTotal } from "../metrics.js";
import { QuoteService, QuoteExpiredError, QuoteNotFoundError } from "./quote-service.js";
import { loadConfig } from "../config.js";
import {
  validateTimelocksAtCreation,
  type TimelockValidationError
} from "../utils/timelock-validator.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_HASHLOCK = "0x" + "0".repeat(64);

export const announceSchema = z.object({
  direction: z.enum(["eth_to_xlm", "xlm_to_eth"]),
  hashlock: z.string().regex(HEX32, "hashlock must be 0x + 64 hex chars").refine(
    (v) => v.toLowerCase() !== ZERO_HASHLOCK.toLowerCase(),
    "hashlock must not be all zeros"
  ),
  srcChain: z.enum(["ethereum", "stellar"]),
  srcAddress: z.string(),
  srcAsset: z.string().min(1),
  srcAmount: z.string().regex(/^\d+$/, "srcAmount must be a decimal integer string"),
  srcSafetyDeposit: z.string().regex(/^\d+$/, "srcSafetyDeposit must be a decimal integer string"),
  dstChain: z.enum(["ethereum", "stellar"]),
  dstAddress: z.string(),
  dstAsset: z.string().min(1),
  dstAmount: z.string().regex(/^\d+$/, "dstAmount must be a decimal integer string"),
  /**
   * Optional: the `quoteId` returned by `GET /api/quotes/eth-xlm`.
   * When present, the coordinator validates that the quote has not
   * expired before accepting the announcement, ensuring fills cannot
   * be based on stale pricing.
   */
  quoteId: z.string().optional()
});

export type AnnounceInput = z.infer<typeof announceSchema>;

export class OrderValidationError extends Error {
  readonly code?: TimelockValidationError;

  constructor(message: string, code?: TimelockValidationError) {
    super(message);
    this.name = "OrderValidationError";
    this.code = code;
  }
}

function assertTimelocksAtCreation(
  srcTimelock: number,
  dstTimelock: number,
  minGapSeconds: number
): void {
  const validation = validateTimelocksAtCreation(srcTimelock, dstTimelock, minGapSeconds);
  if (!validation.isValid && validation.error) {
    const message =
      validation.error === "TIMELOCKS_REVERSED"
        ? "Destination timelock must be strictly before source timelock"
        : "Timelock gap between source and destination is below the minimum safety gap";
    throw new OrderValidationError(message, validation.error);
  }
}

/** A chain event was validly shaped but older than the persisted state. */
export class StaleOrderEventError extends OrderValidationError {
  constructor(message: string) {
    super(message);
    this.name = "StaleOrderEventError";
  }
}

function toOrderError(err: unknown): OrderValidationError {
  if (err instanceof OrderValidationError) return err;
  const message =
    err instanceof Error ? err.message : `invalid address: ${String(err)}`;
  return new OrderValidationError(message);
}

/**
 * Canonicalize a chain address before it is stored or compared.
 *
 * Ethereum addresses are lowercased (case-insensitive hex; mixed-case
 * input must carry a valid EIP-55 checksum) and Stellar accounts are
 * case-sensitive, so their canonical form is the trimmed value itself.
 * Malformed addresses — wrong length, bad characters, whitespace, or a
 * broken EIP-55 checksum — are rejected immediately instead of being
 * persisted under a distinct string that would never match again.
 */
function canonicalizeChainAddress(chain: Chain, addr: string, field: string): string {
  try {
    return normalizeChainAddress(chain, addr, field);
  } catch (err) {
    throw toOrderError(err);
  }
}

/** Canonicalize an address whose chain is inferred from its format. */
function canonicalizeAnyAddress(addr: string, field = "address"): string {
  try {
    return normalizeAddress(addr, field);
  } catch (err) {
    throw toOrderError(err);
  }
}

function validateDirectionAgainstChains(input: AnnounceInput): void {
  const expected: Record<Direction, { src: Chain; dst: Chain }> = {
    eth_to_xlm: { src: "ethereum", dst: "stellar" },
    xlm_to_eth: { src: "stellar", dst: "ethereum" }
  };
  const want = expected[input.direction];
  if (want.src !== input.srcChain || want.dst !== input.dstChain) {
    throw new OrderValidationError(
      `Direction ${input.direction} requires src=${want.src} and dst=${want.dst}`
    );
  }
}

export class OrderService {
  private readonly minGapSeconds: number;

  constructor(
    private readonly repo: OrdersRepository,
    private readonly log: Logger,
    /** Optional — when supplied, quoteId in announce requests is validated. */
    private readonly quoteService?: QuoteService,
    config?: ReturnType<typeof loadConfig>
  ) {
    this.minGapSeconds = config?.timelockSafetyGapSeconds ?? 600;
  }

  /**
   * Record a new order announcement. The coordinator does NOT lock any
   * funds — it simply records the intent so the order book is visible
   * to all resolvers and the user can later attach the on-chain
   * `srcOrderId` once they have locked.
   *
   * When `quoteId` is present in the input, it is validated against
   * the QuoteService before the order is persisted.  Expired or
   * unknown quoteIds are rejected as `OrderValidationError` so the
   * error surfaces cleanly to the caller before any chain action is
   * attempted.
   */
  async announce(input: AnnounceInput): Promise<OrderRow> {
    // Canonicalize both addresses up front so the persisted value is
    // format-independent: ETH is stored lowercase (checksummed or not),
    // Stellar is stored case-exact, and anything else is rejected here
    // before it can ever create a duplicate row that never matches.
    const srcAddress = canonicalizeChainAddress(
      input.srcChain,
      input.srcAddress,
      "srcAddress"
    );
    const dstAddress = canonicalizeChainAddress(
      input.dstChain,
      input.dstAddress,
      "dstAddress"
    );
    validateDirectionAgainstChains(input);

    if (input.hashlock.toLowerCase() === ZERO_HASHLOCK.toLowerCase()) {
      throw new OrderValidationError("hashlock must not be all zeros");
    }

    const hashlock = input.hashlock.toLowerCase() as `0x${string}`;

    // --- Quote freshness gate -------------------------------------------
    if (input.quoteId) {
      if (!this.quoteService) {
        // No QuoteService wired in (e.g. test mode without quotes) — skip.
        this.log.debug({ quoteId: input.quoteId }, "quoteId supplied but no QuoteService wired; skipping freshness check");
      } else {
        try {
          this.quoteService.assertFresh(input.quoteId);
          this.log.debug({ quoteId: input.quoteId }, "quote freshness confirmed");
        } catch (err) {
          if (err instanceof QuoteExpiredError || err instanceof QuoteNotFoundError) {
            throw new OrderValidationError(err.message);
          }
          throw err;
        }
      }
    }
    // -------------------------------------------------------------------

    const existing = await this.repo.findByHashlock(hashlock);
    if (existing) {
      throw new OrderValidationError(
        `An order with hashlock ${hashlock} already exists (publicId=${existing.publicId})`
      );
    }

    // Strip quoteId — it's not a persisted column, just a freshness gate.
    const { quoteId: _q, ...repoInput } = input;
    const order = await this.repo.announce(
      {
        ...repoInput,
        hashlock,
        srcAddress,
        dstAddress
      } as AnnounceOrderInput
    );
    this.log.info(
      { publicId: order.publicId, direction: order.direction, quoteId: input.quoteId ?? null },
      "order announced"
    );
    ordersTotal.inc({ status: "announced" });
    return order;
  }

  get(publicId: string): Promise<OrderRow | null> {
    return this.repo.findByPublicId(publicId);
  }

  getTransitions(publicId: string): Promise<OrderTransitionSummary[]> {
    return this.repo.getTransitions(publicId);
  }

  async history(address: string, limit?: number, offset?: number): Promise<OrderRow[]> {
    // Canonicalize the lookup key the same way rows are stored, so a
    // mixed-case or whitespace-padded query matches instead of silently
    // returning an empty list — and malformed queries are rejected
    // early instead of being executed against the DB.
    const canonical = canonicalizeAnyAddress(address, "address");
    return this.repo.findByAddress(canonical, limit, offset);
  }

  findByHashlock(hashlock: string): Promise<OrderRow | null> {
    return this.repo.findByHashlock(hashlock);
  }

  findByPreimage(preimage: string): Promise<OrderRow | null> {
    return this.repo.findByPreimage(preimage);
  }

  async recordSrcLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
  }): Promise<void> {
    const order = await this.repo.findByPublicId(input.publicId);
    if (!order) throw new OrderValidationError(`unknown order ${input.publicId}`);
    if (order.status === "src_locked") {
      const sameEvent =
        order.srcOrderId === input.orderId &&
        order.srcLockTx === input.txHash &&
        order.srcLockBlock === input.blockNumber &&
        order.srcTimelock === input.timelock;
      if (sameEvent) return;
      throw new StaleOrderEventError(`conflicting src lock event for ${input.publicId}`);
    }
    if (!canTransition(order.status, "src_locked")) {
      throw new StaleOrderEventError(`stale src lock event for order in status ${order.status}`);
    }

    if (order.dstTimelock != null) {
      assertTimelocksAtCreation(input.timelock, order.dstTimelock, this.minGapSeconds);
    }

    await this.repo.recordSrcLock(input);
    this.log.info({ publicId: input.publicId, srcOrderId: input.orderId }, "src lock recorded");
    ordersTotal.inc({ status: "src_locked" });
  }

  async recordDstLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    resolver: string | null;
  }): Promise<void> {
    const order = await this.repo.findByPublicId(input.publicId);
    if (!order) throw new OrderValidationError(`unknown order ${input.publicId}`);

    // The resolver is the account (on the order's DESTINATION chain) that
    // locked the destination funds — canonicalize it so the sameEvent
    // comparison below and any later lookup match on format, not on the
    // exact bytes a caller happened to send.
    const resolver =
      input.resolver != null && input.resolver.trim() !== ""
        ? canonicalizeChainAddress(order.dstChain, input.resolver, "resolver")
        : null;

    if (order.status === "dst_locked") {
      const sameEvent =
        order.dstOrderId === input.orderId &&
        order.dstLockTx === input.txHash &&
        order.dstLockBlock === input.blockNumber &&
        order.dstTimelock === input.timelock &&
        order.resolverAddress === resolver;
      if (sameEvent) return;
      throw new StaleOrderEventError(`conflicting dst lock event for ${input.publicId}`);
    }
    if (!canTransition(order.status, "dst_locked")) {
      throw new StaleOrderEventError(`stale dst lock event for order in status ${order.status}`);
    }

    if (order.srcTimelock != null) {
      assertTimelocksAtCreation(order.srcTimelock, input.timelock, this.minGapSeconds);
    }

    await this.repo.recordDstLock({ ...input, resolver });
    this.log.info({ publicId: input.publicId, dstOrderId: input.orderId }, "dst lock recorded");
    ordersTotal.inc({ status: "dst_locked" });
  }

  async recordSecret(publicId: string, preimage: string, txHash: string): Promise<void> {
    const order = await this.repo.findByPublicId(publicId);
    if (!order) throw new OrderValidationError(`unknown order ${publicId}`);
    // Preimages are 32-byte hex values: compare and store the canonical
    // lowercase form so a mixed-case re-submission matches instead of
    // being misread as a conflicting (different) secret.
    const canonicalPreimage = preimage.toLowerCase();
    if (order.status === "secret_revealed") {
      if (order.preimage?.toLowerCase() !== canonicalPreimage) {
        throw new StaleOrderEventError(`conflicting secret event for ${publicId}`);
      }
      // The same secret was already revealed for this order — whether the
      // re-submission carries the same or a different reveal tx (e.g. the
      // secret is being revealed on both chains). That is idempotent, not
      // a conflict.
      return;
    }
    if (!canTransition(order.status, "secret_revealed")) {
      throw new StaleOrderEventError(`stale secret event for order in status ${order.status}`);
    }
    await this.repo.recordSecretRevealed({ publicId, preimage: canonicalPreimage, txHash });
    this.log.info({ publicId }, "secret recorded");
    ordersTotal.inc({ status: "secret_revealed" });
  }

  async getOrderMetrics(): Promise<OrderMetrics> {
    return this.repo.getMetrics();
  }

  async markStatus(publicId: string, status: OrderRow["status"]): Promise<void> {
    const order = await this.repo.findByPublicId(publicId);
    if (!order) throw new OrderValidationError(`unknown order ${publicId}`);
    if (!canTransition(order.status, status)) {
      throw new OrderValidationError(`cannot transition from ${order.status} to ${status}`);
    }
    await this.repo.setStatus(publicId, status);
    this.log.info({ publicId, status }, "status updated");
    ordersTotal.inc({ status });
  }

  async getSnapshots(): Promise<OrderSnapshot[]> {
    return this.repo.getCompletedOrderSnapshots();
  }
}
