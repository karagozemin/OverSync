import type { Logger } from "pino";
import { z } from "zod";
import {
  OrdersRepository,
  type OrderRow,
  type OrderSnapshot,
  type AnnounceOrderInput,
  type OrderMetrics,
  type Direction,
  type Chain
} from "../persistence/orders-repo.js";
import { canTransition } from "../state-machine/order-machine.js";
import { ordersTotal } from "../metrics.js";
import { QuoteService, QuoteExpiredError, QuoteNotFoundError } from "./quote-service.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export const announceSchema = z.object({
  direction: z.enum(["eth_to_xlm", "xlm_to_eth"]),
  hashlock: z.string().regex(HEX32, "hashlock must be 0x + 64 hex chars"),
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

export class OrderValidationError extends Error {}

function validateChainAddress(chain: Chain, addr: string): void {
  if (chain === "ethereum" && !HEX_ADDRESS.test(addr)) {
    throw new OrderValidationError(`${addr} is not a valid Ethereum address`);
  }
  if (chain === "stellar" && !STELLAR_ADDRESS.test(addr)) {
    throw new OrderValidationError(`${addr} is not a valid Stellar account`);
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
  constructor(
    private readonly repo: OrdersRepository,
    private readonly log: Logger,
    /** Optional — when supplied, quoteId in announce requests is validated. */
    private readonly quoteService?: QuoteService
  ) {}

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
    validateChainAddress(input.srcChain, input.srcAddress);
    validateChainAddress(input.dstChain, input.dstAddress);
    validateDirectionAgainstChains(input);

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

    const existing = await this.repo.findByHashlock(input.hashlock);
    if (existing) {
      throw new OrderValidationError(
        `An order with hashlock ${input.hashlock} already exists (publicId=${existing.publicId})`
      );
    }

    // Strip quoteId — it's not a persisted column, just a freshness gate.
    const { quoteId: _q, ...repoInput } = input;
    const order = await this.repo.announce(repoInput as AnnounceOrderInput);
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

  history(address: string, limit?: number, offset?: number): Promise<OrderRow[]> {
    return this.repo.findByAddress(address, limit, offset);
  }

  findByHashlock(hashlock: string): Promise<OrderRow | null> {
    return this.repo.findByHashlock(hashlock);
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
    if (!canTransition(order.status, "src_locked") && order.status !== "src_locked") {
      throw new OrderValidationError(`cannot record src lock from status ${order.status}`);
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
    if (!canTransition(order.status, "dst_locked") && order.status !== "dst_locked") {
      throw new OrderValidationError(`cannot record dst lock from status ${order.status}`);
    }
    await this.repo.recordDstLock(input);
    this.log.info({ publicId: input.publicId, dstOrderId: input.orderId }, "dst lock recorded");
    ordersTotal.inc({ status: "dst_locked" });
  }

  async recordSecret(publicId: string, preimage: string, txHash: string): Promise<void> {
    const order = await this.repo.findByPublicId(publicId);
    if (!order) throw new OrderValidationError(`unknown order ${publicId}`);
    if (!canTransition(order.status, "secret_revealed") && order.status !== "secret_revealed") {
      throw new OrderValidationError(`cannot record secret from status ${order.status}`);
    }
    await this.repo.recordSecretRevealed({ publicId, preimage, txHash });
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
