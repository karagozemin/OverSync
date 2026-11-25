import type { rpc } from "@stellar/stellar-sdk";
import type { Logger } from "pino";
import type { SorobanConfig } from "../config.js";
import { DEFAULT_MAX_RPC_RESPONSE_BYTES } from "../rpc-response-limit.js";
import { createSorobanRpcClient, type SorobanRpcClient } from "../soroban-rpc.js";

/**
 * Polls the Soroban RPC for HTLC contract events.
 *
 * Soroban does not expose a websocket-style subscription yet, so we
 * poll `getEvents` every `pollIntervalMs`. The cursor is held in memory
 * — restarting the resolver re-fetches from the latest ledger, which is
 * fine because order state is durable on-chain.
 *
 * Any plan that would be submitted on Stellar MUST be re-validated
 * against the canonical order with `validatePlanForSubmit`
 * (`resolver/src/planner`) immediately before it is handed to the
 * submission path. A plan that drifted, or whose timelock expired while
 * it waited, is rejected and never submitted.
 */
export class SorobanListener {
  private readonly server: SorobanRpcClient;
  private readonly log: Logger;
  private readonly cfg: SorobanConfig;
  private readonly pollMs: number;
  private cursor: string | undefined;
  private stopped = false;

  constructor(
    cfg: SorobanConfig,
    pollMs: number,
    log: Logger,
    maxResponseBytes: number = DEFAULT_MAX_RPC_RESPONSE_BYTES
  ) {
    this.cfg = cfg;
    this.pollMs = pollMs;
    this.log = log.child({ component: "SorobanListener" });
    this.server = createSorobanRpcClient(cfg.rpcUrl, {
      allowHttp: cfg.rpcUrl.startsWith("http://"),
      maxResponseBytes
    });
  }

  async start(handlers: SorobanEventHandlers): Promise<void> {
    if (!this.cfg.htlc) {
      this.log.warn("SOROBAN_HTLC contract id not configured — skipping Soroban listener");
      return;
    }
    const contractId = this.cfg.htlc;
    this.log.info({ contract: contractId, rpc: this.cfg.rpcUrl }, "starting Soroban listener");

    const tick = async () => {
      if (this.stopped) return;
      try {
        const latest = await this.server.getLatestLedger();
        const startLedger = this.cursor === undefined ? latest.sequence - 1 : undefined;

        const req: rpc.Server.GetEventsRequest = {
          filters: [
            {
              type: "contract",
              contractIds: [contractId]
            }
          ],
          startLedger: startLedger,
          cursor: this.cursor,
          limit: 100
        };
        const events = await this.server.getEvents(req);

        for (const ev of events.events) {
          handlers.onContractEvent({
            ledger: Number(ev.ledger),
            txHash: ev.txHash,
            contractId: ev.contractId?.toString() ?? contractId,
            topics: ev.topic.map((t: any) => t.toXDR ? t.toXDR("base64") : String(t)),
            value: (ev.value as any)?.toXDR ? (ev.value as any).toXDR("base64") : String(ev.value)
          });
        }
        if (events.cursor) {
          this.cursor = events.cursor;
        }
      } catch (err) {
        this.log.warn({ err }, "Soroban poll failed");
      } finally {
        if (!this.stopped) {
          setTimeout(tick, this.pollMs);
        }
      }
    };

    void tick();
  }

  stop(): void {
    this.stopped = true;
  }
}

export interface SorobanRawEvent {
  ledger: number;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export interface SorobanEventHandlers {
  onContractEvent(e: SorobanRawEvent): void;
}
