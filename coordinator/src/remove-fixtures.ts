import { loadConfig } from "./config.js";
import { getLogger } from "./logger.js";
import { openDatabase } from "./persistence/db.js";
import { OrdersRepository } from "./persistence/orders-repo.js";
import { fixturesAllowedForNetwork } from "./persistence/demo-fixtures.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = getLogger(cfg.logLevel);

  // Network gate FIRST (#279): on mainnet we never delete anything. The
  // fixture-vs-real distinction is enforced by the repository (it only ever
  // touches rows with fixture = 1), but on mainnet the risk of a misflagged
  // real order is not worth taking — refuse outright.
  if (!fixturesAllowedForNetwork(cfg.soroban.networkPassphrase)) {
    log.warn(
      { network: "mainnet" },
      "Fixture removal refused: coordinator is on mainnet"
    );
    await gracefulExit(1);
    return;
  }

  const db = await openDatabase(cfg.databaseUrl, {
    sqliteBusyTimeoutMs: cfg.sqliteBusyTimeoutMs
  });
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
