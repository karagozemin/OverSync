/**
 * Rate-limited concurrency runner.
 *
 * In dry-run mode every order is exercised through the in-process
 * EvmHtlcSim / SorobanHtlcSim so the full claim/refund state machine is
 * exercised without any live RPC calls.
 *
 * In live mode the stub throws a clear "not yet implemented" error so that
 * someone wiring up real Sepolia/Soroban clients cannot accidentally submit
 * a half-finished implementation to testnet.
 */
import type { PlannedOrder } from "./orders.js";
import type { LoadTestConfig } from "./config.js";
import { EvmHtlcSim, SorobanHtlcSim } from "../sim.js";

export interface OrderResult {
  index: number;
  orderId: string;
  direction: PlannedOrder["direction"];
  resolverAction: PlannedOrder["resolverAction"];
  status: "filled" | "timed-out" | "failed";
  errorMessage?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Dry-run execution
// ---------------------------------------------------------------------------

function executeDryRun(order: PlannedOrder): OrderResult {
  const start = Date.now();
  try {
    const evm = new EvmHtlcSim();
    const soroban = new SorobanHtlcSim();

    const evmId = evm.createOrder({
      hashlock: order.hashlock,
      timelockSeconds: order.timelockSeconds,
    });
    const sorobanId = soroban.createOrder({
      hashlock: order.hashlock,
      timelockSeconds: order.timelockSeconds,
    });

    if (order.resolverAction === "fill") {
      // Direction determines which chain the resolver claims first, but both
      // must eventually be claimed with the same preimage.
      if (order.direction === "ETH_TO_XLM") {
        evm.claimOrder(evmId, order.preimage);
        soroban.claimOrder(sorobanId, order.preimage);
      } else {
        soroban.claimOrder(sorobanId, order.preimage);
        evm.claimOrder(evmId, order.preimage);
      }
      return {
        index: order.index,
        orderId: order.orderId,
        direction: order.direction,
        resolverAction: order.resolverAction,
        status: "filled",
        durationMs: Date.now() - start,
      };
    }

    // timeout path: advance both clocks past the timelock, then refund.
    evm.advanceTime(order.timelockSeconds + 1);
    soroban.advanceTime(order.timelockSeconds + 1);
    evm.refundOrder(evmId);
    soroban.refundOrder(sorobanId);

    return {
      index: order.index,
      orderId: order.orderId,
      direction: order.direction,
      resolverAction: order.resolverAction,
      status: "timed-out",
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      index: order.index,
      orderId: order.orderId,
      direction: order.direction,
      resolverAction: order.resolverAction,
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Live execution stub
// ---------------------------------------------------------------------------

function executeLive(order: PlannedOrder): OrderResult {
  // This stub exists so that the harness config / rate-limiting / report
  // machinery can be validated before real RPC calls are wired in.
  // Replace this body with viem + @stellar/stellar-sdk calls before running
  // the 1k-order soak.
  return {
    index: order.index,
    orderId: order.orderId,
    direction: order.direction,
    resolverAction: order.resolverAction,
    status: "failed",
    errorMessage:
      "Live RPC execution is not yet implemented. " +
      "Wire up Sepolia/Soroban clients in runner.ts:executeLive() before scheduling the soak.",
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Token-bucket rate limiter
// ---------------------------------------------------------------------------

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly perSec: number) {
    this.tokens = perSec;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.perSec, this.tokens + elapsed * this.perSec);
      this.lastRefill = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitMs = Math.ceil(((1 - this.tokens) / this.perSec) * 1000);
      await new Promise<void>((r) => setTimeout(r, waitMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runOrders(
  orders: PlannedOrder[],
  config: LoadTestConfig,
  onProgress?: (result: OrderResult, completed: number, total: number) => void
): Promise<OrderResult[]> {
  const results: OrderResult[] = [];
  const limiter = new RateLimiter(config.rateLimitPerSec);
  let completed = 0;

  // Share a mutable queue across all workers so they don't double-process.
  const queue = [...orders];

  const worker = async (): Promise<void> => {
    for (;;) {
      const order = queue.shift();
      if (!order) return;

      await limiter.acquire();

      const result = config.dryRun ? executeDryRun(order) : executeLive(order);
      results.push(result);
      completed++;
      onProgress?.(result, completed, orders.length);
    }
  };

  await Promise.all(
    Array.from({ length: config.concurrency }, worker)
  );

  return results.sort((a, b) => a.index - b.index);
}
