import { rpc } from "@stellar/stellar-sdk";
import type { Logger } from "pino";
import type { CoordinatorConfig } from "../config.js";
import type { OrderService } from "../services/order-service.js";
import { listenerLastBlock } from "../metrics.js";
import { OrderEventApplier } from "./order-events.js";
import { decodeSorobanOrderEvent } from "./soroban-events.js";

/**
 * Polls the Soroban RPC for HTLC contract events, decodes the `created` /
 * `claimed` / `refunded` topics published by `oversync-htlc` (see
 * `soroban-events.ts`) and feeds them into the same order state machine the
 * Ethereum listener and the HTTP API use.
 */
export class SorobanListener {
  private readonly server: rpc.Server;
  private readonly log: Logger;
  private readonly applier: OrderEventApplier;
  private cursor: string | undefined;
  private resumeLedger: number | undefined;
  private lastLedger = 0;
  private stopped = false;

  constructor(
    private readonly cfg: CoordinatorConfig,
    orders: OrderService,
    log: Logger
  ) {
    this.log = log.child({ component: "SorobanListener" });
    this.applier = new OrderEventApplier(orders, this.log, "soroban-listener");
    this.server = new rpc.Server(cfg.soroban.rpcUrl, {
      allowHttp: cfg.soroban.rpcUrl.startsWith("http://")
    });
  }

  private get networkId(): string {
    return this.cfg.soroban.networkPassphrase;
  }

  /** Throws CursorMismatchError when the saved cursor belongs to another network. */
  async start(): Promise<void> {
    if (!this.cfg.soroban.htlcContract) {
      this.log.warn("SOROBAN_HTLC contract not configured — Soroban listener disabled");
      return;
    }
    const contractId = this.cfg.soroban.htlcContract;
    this.log.info({ contract: contractId }, "starting");
    if (this.events) {
      const saved = await this.events.resume("soroban", this.networkId);
      if (saved) {
        this.cursor = saved.cursor ?? undefined;
        this.resumeLedger = saved.cursor ? undefined : saved.position;
      }
    }
    void this.loop(contractId);
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(contractId: string): Promise<void> {
    while (!this.stopped) {
      try {
        const latest = await this.server.getLatestLedger();
        listenerLastBlock.set({ chain: "soroban" }, latest.sequence);
        const startLedger =
          this.cursor === undefined ? this.resumeLedger ?? latest.sequence - 1 : undefined;
        const events = await this.server.getEvents({
          filters: [{ type: "contract", contractIds: [contractId] }],
          startLedger: startLedger,
          cursor: this.cursor,
          limit: 100
        });
        for (const ev of events.events) {
          const decoded = decodeSorobanOrderEvent({
            topic: ev.topic,
            value: ev.value,
            txHash: ev.txHash,
            ledger: ev.ledger
          });
          if (!decoded) {
            this.log.debug(
              { ledger: ev.ledger, txHash: ev.txHash, topics: ev.topic?.length ?? 0 },
              "Soroban event ignored (not a lifecycle event)"
            );
            continue;
          }
          const outcome = await this.applier.apply(decoded);
          this.applier.logOutcome(decoded, outcome);
        }
        if (events.cursor) this.cursor = events.cursor;
        this.resumeLedger = undefined;
        if (this.events) {
          // Persist only after the batch was handled above.
          await this.events.advance(
            "soroban",
            this.networkId,
            Math.max(this.lastLedger, latest.sequence),
            this.cursor ?? null
          );
        }
      } catch (err) {
        this.log.warn({ err }, "Soroban poll failed");
      }
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }
}
