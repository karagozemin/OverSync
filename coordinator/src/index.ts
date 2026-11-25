import { loadConfig } from "./config.js";
import { parseCorsOrigins } from "./server/cors.js";
import { getLogger } from "./logger.js";
import { openDatabase } from "./persistence/db.js";
import { OrdersRepository } from "./persistence/orders-repo.js";
import { seedDemoFixtures } from "./persistence/demo-fixtures.js";
import { OrderService } from "./services/order-service.js";
import { QuoteService } from "./services/quote-service.js";
import { SecretService } from "./services/secret-service.js";
import { createApp } from "./server/app.js";
import { createCoordinatorServer } from "./server/timeouts.js";
import { EthereumListener } from "./listeners/ethereum-listener.js";
import { ChainEventProcessor } from "./services/chain-events.js";
import { SorobanListener } from "./listeners/soroban-listener.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info({ network: cfg.network, port: cfg.port }, "OverSync coordinator starting");

  const db = await openDatabase(cfg.databaseUrl);
  const repo = new OrdersRepository(db);

  if (cfg.demoFixtures) {
    // Pass the network passphrase so the loader can refuse mainnet itself
    // before touching the database (#279).
    await seedDemoFixtures(repo, log, cfg.soroban.networkPassphrase);
  }

  const quotes = new QuoteService(log);
  const orders = new OrderService(repo, log, quotes, cfg);
  const secrets = new SecretService(orders, log);

  const app = createApp({
    log,
    corsOrigins: parseCorsOrigins(cfg.corsOrigins),
    maxRequestBodyBytes: cfg.maxRequestBodyBytes,
    orders,
    secrets,
    quotes
  });

  // Built explicitly rather than with app.listen() so the request limits are in
  // force before the first connection is accepted.
  const server = createCoordinatorServer(app, cfg.serverTimeouts);
  server.listen(cfg.port, () => {
    log.info({ port: cfg.port, ...cfg.serverTimeouts }, "HTTP server listening");
  });

  const chainEvents = new ChainEventProcessor(repo, orders, secrets, log);
  const ethListener = new EthereumListener(cfg, orders, log, chainEvents);
  const sorobanListener = new SorobanListener(cfg, orders, log, chainEvents);
  // A cursor saved for another network aborts startup (see main().catch).
  await ethListener.start();
  await sorobanListener.start();

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    ethListener.stop();
    sorobanListener.stop();
    server.close(() => {
      // Close database if it has a close method (SQLite)
      if ('close' in db) {
        (db as any).close();
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal coordinator startup error:", err);
  process.exit(1);
});
