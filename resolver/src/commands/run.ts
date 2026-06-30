import { loadConfig } from "../config.js";
import { getLogger } from "../logger.js";
import { EthereumListener } from "../listeners/ethereum.js";
import { SorobanListener } from "../listeners/soroban.js";
import { checkPreflight } from "./check.js";

export async function runCommand(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info({ network: cfg.network }, "OverSync resolver starting");

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
      // Resolver fill logic will be added in Phase 5 once the SDK exposes the
      // counterpart Soroban submission helper. Until then this resolver is
      // observe-only and the reference coordinator handles secret relay.
    },
    onOrderClaimed: (e) => {
      log.info({ orderId: e.orderId.toString(), preimage: e.preimage }, "ETH order claimed");
    },
    onOrderRefunded: (e) => {
      log.info({ orderId: e.orderId.toString() }, "ETH order refunded");
    }
  });

  await stellar.start({
    onContractEvent: (e) => {
      log.info({ ledger: e.ledger, txHash: e.txHash, topics: e.topics.length }, "Soroban event");
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
