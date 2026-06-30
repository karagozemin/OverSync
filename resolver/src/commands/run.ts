import { loadConfig } from "../config.js";
import { getLogger } from "../logger.js";
<<<<<<< Updated upstream
=======
<<<<<<< HEAD
import { EthereumListener } from "../listeners/ethereum.js";
import { SorobanListener } from "../listeners/soroban.js";
import { checkPreflight } from "./check.js";
=======
>>>>>>> Stashed changes
import { EthereumListener, type EthereumOrderCreatedEvent } from "../listeners/ethereum.js";
import { SorobanListener, type SorobanRawEvent } from "../listeners/soroban.js";
import { planDestinationOrder, type DestinationOrderPlan } from "../planner/index.js";
import { decodeSorobanEvent } from "../soroban-event-decoder.js";
<<<<<<< Updated upstream
=======
>>>>>>> de0c163 (fix(resolver): resolve broken @oversync/sdk type imports)
>>>>>>> Stashed changes

export async function runCommand(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info({ network: cfg.network, dryRun: cfg.dryRun }, "OverSync resolver starting");
<<<<<<< Updated upstream
=======

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
>>>>>>> Stashed changes

  const eth = new EthereumListener(cfg.ethereum, log);
  const stellar = new SorobanListener(cfg.soroban, cfg.pollIntervalMs, log);

  const handleSourceOrder = async (plan: DestinationOrderPlan) => {
    log.info({ plan }, "destination-leg plan generated");
    if (cfg.dryRun) {
      log.info({ plan }, "dry-run mode enabled; not submitting destination transaction");
      return;
    }
    log.warn(
      "resolver dry-run only: destination submission is not yet implemented; set RESOLVER_DRY_RUN=true only for safe planning without funds"
    );
  };

  await eth.start({
    onOrderCreated: async (e: EthereumOrderCreatedEvent) => {
      log.info({ orderId: e.orderId.toString(), hashlock: e.hashlock, amount: e.amount.toString() }, "ETH order created");
      try {
        const plan = planDestinationOrder({ direction: "eth_to_xlm", sourceOrder: e, cfg });
        await handleSourceOrder(plan);
      } catch (err) {
        log.error({ err, orderId: e.orderId.toString() }, "failed to plan destination order");
      }
    },
    onOrderClaimed: (e) => {
      log.info({ orderId: e.orderId.toString(), preimage: e.preimage }, "ETH order claimed");
    },
    onOrderRefunded: (e) => {
      log.info({ orderId: e.orderId.toString(), caller: e.caller }, "ETH order refunded");
    }
  });

  await stellar.start({
    onContractEvent: async (e: SorobanRawEvent) => {
      log.info({ ledger: e.ledger, txHash: e.txHash, topics: e.topics.length }, "Soroban event");
      const decoded = decodeSorobanEvent(e);
      if (!decoded) return;
      if (decoded.type === "OrderCreated") {
        try {
          const plan = planDestinationOrder({ direction: "xlm_to_eth", sourceOrder: decoded.event, cfg });
          await handleSourceOrder(plan);
        } catch (err) {
          log.error({ err, txHash: e.txHash }, "failed to plan destination order from Soroban event");
        }
      }
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
