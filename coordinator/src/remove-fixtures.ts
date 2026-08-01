import { loadConfig } from "./config.js";
import { getLogger } from "./logger.js";
import { openDatabase } from "./persistence/db.js";
import { OrdersRepository } from "./persistence/orders-repo.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);
  const db = await openDatabase(cfg.databaseUrl);
  const repo = new OrdersRepository(db);

  const before = await repo.countFixtures();
  if (before === 0) {
    log.info("No demo fixtures found in the database");
    await gracefulExit(0);
    return;
  }

  log.info({ count: before }, "Removing demo fixture orders");
  const removed = await repo.removeFixtures();
  log.info({ removed }, "Demo fixture orders removed");

  await gracefulExit(0);
}

async function gracefulExit(code: number): Promise<void> {
  // Allow pending promises to settle
  await new Promise((r) => setTimeout(r, 50));
  process.exit(code);
}

main().catch((err) => {
  console.error("Failed to remove fixtures:", err);
  process.exit(1);
});
