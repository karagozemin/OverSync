import { loadConfig } from "./config.js";
import { parseCorsOrigins } from "./server/cors.js";
import { getLogger } from "./logger.js";
import { openDatabase } from "./persistence/db.js";
import { OrdersRepository } from "./persistence/orders-repo.js";
import { OrderService } from "./services/order-service.js";
import { QuoteService } from "./services/quote-service.js";
import { SecretService } from "./services/secret-service.js";
import { createApp } from "./server/app.js";
import { EthereumListener } from "./listeners/ethereum-listener.js";
import { SorobanListener } from "./listeners/soroban-listener.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  log.info({ network: cfg.network, port: cfg.port }, "OverSync coordinator starting");

  const db = await openDatabase(cfg.databaseUrl);
  const repo = new OrdersRepository(db);
  const quotes = new QuoteService(log);
  const orders = new OrderService(repo, log, quotes);
  const secrets = new SecretService(orders, log);

  const app = createApp({
    log,
    corsOrigins: parseCorsOrigins(cfg.corsOrigins),
    maxRequestBodyBytes: cfg.maxRequestBodyBytes,
    orders,
    secrets,
    quotes
  });

  const server = app.listen(cfg.port, () => {
    log.info({ port: cfg.port }, "HTTP server listening");
  });

  const ethListener = new EthereumListener(cfg, orders, log);
  const sorobanListener = new SorobanListener(cfg, orders, log);
  ethListener.start();
  sorobanListener.start();

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
