import { loadConfig } from "../config.js";
import { getLogger } from "../logger.js";
import { EthereumListener } from "../listeners/ethereum.js";
import { SorobanListener } from "../listeners/soroban.js";
import { redactLogObject } from "@oversync/sdk/logging";
import { checkPreflight } from "./check.js";
import { buildPlan } from "../planner/index.js";
import { observedFromEthereumEvent } from "../planner/index.js";

export interface RunOptions {
  dryRun?: boolean;
}

export async function runCommand(opts: RunOptions = {}): Promise<void> {
  const dryRun = opts.dryRun ?? process.env.RESOLVER_DRY_RUN === "true";
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info({ network: cfg.network, dryRun }, "OverSync resolver starting");

  // Run preflight check in warning mode
  const preflightResults = await checkPreflight();
  for (const r of preflightResults) {
    if (!r.configured) {
      log.warn({ chain: r.chain, reason: r.reason }, "Registry not configured; running in observation/dry-run mode for this chain");
    } else if (r.active === false) {
      log.warn({ chain: r.chain }, "Resolver is inactive/unstaked. Fills will fail until registered.");
    } else if (r.active === "unknown") {
      log.warn({ chain: r.chain, reason: r.reason }, "Could not verify active status");
    }
  }

  const eth = new EthereumListener(cfg.ethereum, log);
  const stellar = new SorobanListener(cfg.soroban, cfg.pollIntervalMs, log);

  await eth.start({
    onOrderCreated: (e) => {
      log.info({ orderId: e.orderId.toString(), hashlock: e.hashlock, amount: e.amount.toString() }, "ETH order created");

      const order = observedFromEthereumEvent(e);
      const result = buildPlan(order, cfg, { dryRun });

      if (!result.ok) {
        log.warn({ errors: result.errors, orderId: e.orderId.toString() }, "Planner rejected ETH order");
        return;
      }

      const { plan } = result;
      log.info(
        {
          direction: plan.direction,
          destinationChain: plan.destination.destinationChain,
          destinationAmount: plan.destination.amount.toString(),
          destinationTimelock: plan.destination.timelockSeconds.toString(),
          hashlock: plan.destination.hashlock,
          fee: (order.amount - plan.destination.amount).toString()
        },
        dryRun
          ? "[DRY-RUN] Would fill ETH order on Soroban"
          : "Planned fill for ETH order on Soroban"
      );
    },
    onOrderClaimed: (e) => {
      log.info(redactLogObject({ orderId: e.orderId.toString(), preimage: e.preimage }), "ETH order claimed");
    },
    onOrderRefunded: (e) => {
      log.info({ orderId: e.orderId.toString() }, "ETH order refunded");
    }
  });

  await stellar.start({
    onContractEvent: (e) => {
      log.info({ ledger: e.ledger, txHash: e.txHash, topics: e.topics.length }, "Soroban event");
      // Soroban event parsing for the planner will be added once the
      // oversync-htlc contract's event schema is finalised. Until then
      // the Soroban listener is observe-only.
    }
  });

  const shutdown = async () => {
    log.info("shutting down");
    await eth.stop();
    stellar.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.info("resolver running; press Ctrl-C to exit");
}
