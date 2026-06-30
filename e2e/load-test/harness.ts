/**
 * OverSync Sepolia/Stellar load-test harness.
 *
 * Dry-run (default — no keys or live RPC needed):
 *   pnpm --filter @oversync/e2e load-test
 *
 * Custom order count / seed:
 *   LOAD_TEST_ORDERS=50 LOAD_TEST_SEED=my-run pnpm --filter @oversync/e2e load-test
 *
 * Live testnet mode (requires SEPOLIA_RPC_URL + RESOLVER_ETH_PRIVATE_KEY):
 *   LOAD_TEST_LIVE=true LOAD_TEST_ORDERS=20 pnpm --filter @oversync/e2e load-test
 *
 * Full 1k-order soak (requires LOAD_TEST_ALLOW_LARGE=true in live mode):
 *   LOAD_TEST_LIVE=true LOAD_TEST_ORDERS=1000 LOAD_TEST_ALLOW_LARGE=true \
 *     LOAD_TEST_RATE_PER_SEC=3 pnpm --filter @oversync/e2e load-test
 *
 * See e2e/load-test/config.ts for the full list of env vars.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { generateOrders } from "./orders.js";
import { runOrders } from "./runner.js";
import { buildReport, writeReports } from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));

function bar(filled: number, total: number, width = 30): string {
  const pct = total > 0 ? filled / total : 0;
  const done = Math.round(pct * width);
  return `[${"#".repeat(done)}${".".repeat(width - done)}] ${(pct * 100).toFixed(0).padStart(3)} %`;
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Load + validate config
  // -------------------------------------------------------------------------
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(
      `\n[ERROR] Configuration failure:\n  ${err instanceof Error ? err.message : err}\n\n`
    );
    process.stderr.write(
      "Run without LOAD_TEST_LIVE to use dry-run mode (no keys required).\n\n"
    );
    process.exit(1);
  }

  const mode = config.dryRun ? "DRY-RUN (simulated)" : "LIVE — Sepolia + Stellar testnet";

  process.stdout.write(`\n${"═".repeat(56)}\n`);
  process.stdout.write(`  OverSync Load-Test Harness\n`);
  process.stdout.write(`${"═".repeat(56)}\n`);
  process.stdout.write(`  Mode         : ${mode}\n`);
  process.stdout.write(`  Seed         : ${config.seed}\n`);
  process.stdout.write(`  Orders       : ${config.orders}\n`);
  process.stdout.write(`  Concurrency  : ${config.concurrency} workers\n`);
  process.stdout.write(`  Rate limit   : ${config.rateLimitPerSec} orders / sec\n`);
  process.stdout.write(`  Timelock     : ${config.timelockSeconds} s\n`);
  if (!config.dryRun) {
    process.stdout.write(`  Sepolia RPC  : ${config.sepoliaRpcUrl}\n`);
    process.stdout.write(`  Soroban RPC  : ${config.sorobanRpcUrl}\n`);
  }
  process.stdout.write(`${"─".repeat(56)}\n\n`);

  // -------------------------------------------------------------------------
  // 2. Generate deterministic orders
  // -------------------------------------------------------------------------
  process.stdout.write(`Generating ${config.orders} deterministic orders...\n`);
  const orders = generateOrders(config.seed, config.orders, config.timelockSeconds);

  const ethToXlm = orders.filter((o) => o.direction === "ETH_TO_XLM").length;
  const xlmToEth = orders.filter((o) => o.direction === "XLM_TO_ETH").length;
  const plannedFills = orders.filter((o) => o.resolverAction === "fill").length;
  const plannedTimeouts = orders.filter((o) => o.resolverAction === "timeout").length;

  process.stdout.write(
    `  Direction mix : ${ethToXlm} ETH→XLM  /  ${xlmToEth} XLM→ETH\n`
  );
  process.stdout.write(
    `  Resolver plan : ${plannedFills} fills  /  ${plannedTimeouts} timeouts\n`
  );
  process.stdout.write(
    `  Est. RPC calls: ${plannedFills * 4 + plannedTimeouts * 3}\n\n`
  );

  // -------------------------------------------------------------------------
  // 3. Run
  // -------------------------------------------------------------------------
  process.stdout.write(`Running orders...\n`);
  const startMs = Date.now();
  let lastPrint = 0;

  const results = await runOrders(orders, config, (_result, completed, total) => {
    const now = Date.now();
    if (now - lastPrint >= 250 || completed === total) {
      process.stdout.write(`\r  ${bar(completed, total)}  ${completed}/${total}`);
      lastPrint = now;
    }
  });

  const durationMs = Date.now() - startMs;
  process.stdout.write(`\n\n`);

  // -------------------------------------------------------------------------
  // 4. Summarise to stdout
  // -------------------------------------------------------------------------
  const filled = results.filter((r) => r.status === "filled").length;
  const timedOut = results.filter((r) => r.status === "timed-out").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const passRate =
    results.length > 0
      ? (((filled + timedOut) / results.length) * 100).toFixed(1)
      : "0.0";

  process.stdout.write(`${"─".repeat(56)}\n`);
  process.stdout.write(`  Filled        : ${filled}\n`);
  process.stdout.write(`  Timed-out     : ${timedOut}\n`);
  process.stdout.write(`  Failed        : ${failed}\n`);
  process.stdout.write(`  Pass rate     : ${passRate} %\n`);
  process.stdout.write(`  Duration      : ${(durationMs / 1000).toFixed(2)} s\n`);
  process.stdout.write(`${"─".repeat(56)}\n\n`);

  if (failed > 0) {
    const sample = results
      .filter((r) => r.status === "failed")
      .slice(0, 3);
    process.stderr.write(`[WARN] ${failed} order(s) failed. First failures:\n`);
    for (const f of sample) {
      process.stderr.write(`  #${f.index} ${f.orderId} — ${f.errorMessage}\n`);
    }
    if (failed > 3) {
      process.stderr.write(`  …and ${failed - 3} more (see JSON report).\n`);
    }
    process.stderr.write(`\n`);
  }

  // -------------------------------------------------------------------------
  // 5. Write reports
  // -------------------------------------------------------------------------
  const report = buildReport(config, orders, results, durationMs);
  const outputDir = resolve(here, config.outputDir);
  const { jsonPath, mdPath } = writeReports(report, outputDir);

  process.stdout.write(`Reports written:\n`);
  process.stdout.write(`  JSON : ${jsonPath}\n`);
  process.stdout.write(`  MD   : ${mdPath}\n\n`);
  process.stdout.write(
    `Reproduce: LOAD_TEST_SEED=${config.seed} pnpm --filter @oversync/e2e load-test\n\n`
  );

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n[FATAL] ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
