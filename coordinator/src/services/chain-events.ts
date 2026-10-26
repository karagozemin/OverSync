import type { Logger } from "pino";
import type { ChainName, OrdersRepository, OrderRow } from "../persistence/orders-repo.js";
import { OrderService, OrderValidationError, StaleOrderEventError } from "./order-service.js";
import type { SecretService } from "./secret-service.js";

/** The persisted cursor belongs to a different network than the configured one. */
export class CursorMismatchError extends Error {
  constructor(
    public readonly chain: ChainName,
    public readonly stored: string,
    public readonly configured: string
  ) {
    super(
      `${chain} cursor was saved for network "${stored}" but the coordinator is configured for "${configured}"; ` +
        "refusing to start. Point DATABASE_URL at the matching database or reset the cursor deliberately."
    );
    this.name = "CursorMismatchError";
  }
}

export type SettlementEvent = {
  chain: ChainName;
  kind: "claimed" | "refunded";
  /** On-chain order id as recorded by `recordSrcLock` / `recordDstLock`. */
  onchainOrderId: string;
  txHash: string;
  /** Position of the log inside its transaction/block; part of the dedupe key. */
  logIndex: number;
  /** Ethereum block number or Soroban ledger sequence. */
  position: number;
  preimage?: string;
};

export type ProcessOutcome = "applied" | "duplicate" | "ignored";

const ORDER_CHAIN = { ethereum: "ethereum", soroban: "stellar" } as const;

/**
 * Applies chain settlement events (claim / refund) to order state exactly
 * once, and persists the per-chain cursor so a restart resumes where the
 * previous run stopped.
 *
 * Crash safety: the order transition is applied first, then the event is
 * marked processed, then the cursor advances. A crash between any two steps
 * only causes redelivery, and redelivery is harmless because the order
 * transitions are idempotent and processed events are skipped.
 */
export class ChainEventProcessor {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly orders: OrderService,
    private readonly secrets: SecretService,
    private readonly log: Logger
  ) {}

  /**
   * Load the saved position for `chain`, rejecting a cursor that was saved
   * for a different network. Returns null when nothing has been persisted.
   */
  async resume(chain: ChainName, networkId: string): Promise<{ position: number; cursor: string | null } | null> {
    const saved = await this.repo.getChainCursor(chain);
    if (!saved) return null;
    if (saved.networkId !== networkId) {
      throw new CursorMismatchError(chain, saved.networkId, networkId);
    }
    return { position: saved.position, cursor: saved.cursor };
  }

  async advance(chain: ChainName, networkId: string, position: number, cursor?: string | null): Promise<void> {
    await this.resume(chain, networkId); // re-validate the network before writing
    await this.repo.saveChainCursor({ chain, networkId, position, cursor });
  }

  async process(networkId: string, ev: SettlementEvent): Promise<ProcessOutcome> {
    const eventKey = `${ev.chain}:${networkId}:${ev.txHash.toLowerCase()}:${ev.logIndex}:${ev.kind}`;
    if (await this.repo.hasProcessedEvent(eventKey)) return "duplicate";

    const outcome = await this.apply(ev);
    await this.repo.markEventProcessed({
      eventKey,
      chain: ev.chain,
      kind: ev.kind,
      position: ev.position
    });
    return outcome;
  }

  /**
   * Process events in order, then move the cursor to `upTo`. Stops without
   * advancing past the first event that fails for a retryable reason, so the
   * event is delivered again on the next run.
   */
  async processBatch(
    networkId: string,
    chain: ChainName,
    events: SettlementEvent[],
    upTo: number,
    cursor?: string | null
  ): Promise<{ applied: number; duplicates: number; ignored: number }> {
    const counts = { applied: 0, duplicates: 0, ignored: 0 };
    const ordered = [...events].sort((a, b) => a.position - b.position || a.logIndex - b.logIndex);
    for (const ev of ordered) {
      const outcome = await this.process(networkId, ev);
      if (outcome === "applied") counts.applied++;
      else if (outcome === "duplicate") counts.duplicates++;
      else counts.ignored++;
    }
    await this.advance(chain, networkId, upTo, cursor);
    return counts;
  }

  private async findOrder(ev: SettlementEvent): Promise<OrderRow | null> {
    const chain = ORDER_CHAIN[ev.chain];
    return (
      (await this.repo.findBySrcOrderId(chain, ev.onchainOrderId)) ??
      (await this.repo.findByDstOrderId(chain, ev.onchainOrderId))
    );
  }

  private async apply(ev: SettlementEvent): Promise<ProcessOutcome> {
    const order = await this.findOrder(ev);
    if (!order) {
      this.log.info({ chain: ev.chain, orderId: ev.onchainOrderId, kind: ev.kind }, "settlement event for unknown order");
      return "ignored";
    }
    try {
      if (ev.kind === "refunded") {
        if (order.status === "refunded") return "duplicate";
        await this.orders.recordRefund(order.publicId, ev.txHash);
      } else {
        if (!ev.preimage) return "ignored";
        if (order.secretRevealedTx === ev.txHash && order.preimage) return "duplicate";
        await this.secrets.reveal(order.publicId, ev.preimage, ev.txHash);
      }
      return "applied";
    } catch (err) {
      // Permanent rejections must not wedge the cursor; anything else
      // (database errors, ...) propagates so the event is retried.
      if (err instanceof StaleOrderEventError || err instanceof OrderValidationError) {
        this.log.warn({ publicId: order.publicId, kind: ev.kind, reason: err.message }, "settlement event ignored");
        return "ignored";
      }
      if (err instanceof Error && /^preimage /.test(err.message)) {
        this.log.warn({ publicId: order.publicId, reason: err.message }, "claim event rejected");
        return "ignored";
      }
      throw err;
    }
  }
}
