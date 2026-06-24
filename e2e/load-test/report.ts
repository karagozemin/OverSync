import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlannedOrder } from "./orders.js";
import type { LoadTestConfig } from "./config.js";
import type { OrderResult } from "./runner.js";

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface SoakReport {
  meta: {
    timestamp: string;
    seed: string;
    dryRun: boolean;
    durationMs: number;
  };
  config: {
    orders: number;
    concurrency: number;
    rateLimitPerSec: number;
    timelockSeconds: number;
  };
  summary: {
    totalOrders: number;
    filled: number;
    timedOut: number;
    failed: number;
    ethToXlm: number;
    xlmToEth: number;
    /**
     * fill: 4 RPC calls (fund + claim on each chain)
     * timeout: 3 RPC calls (fund on each chain + 1 timelock-check each = 4,
     *          but we credit 3 to be conservative since one side self-expires)
     */
    estimatedRpcCalls: number;
    p50DurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
  };
  failures: Array<{ index: number; orderId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function buildReport(
  config: LoadTestConfig,
  orders: PlannedOrder[],
  results: OrderResult[],
  durationMs: number
): SoakReport {
  const filled = results.filter((r) => r.status === "filled").length;
  const timedOut = results.filter((r) => r.status === "timed-out").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const ethToXlm = orders.filter((o) => o.direction === "ETH_TO_XLM").length;
  const xlmToEth = orders.filter((o) => o.direction === "XLM_TO_ETH").length;

  const estimatedRpcCalls = filled * 4 + timedOut * 3;

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

  return {
    meta: {
      timestamp: new Date().toISOString(),
      seed: config.seed,
      dryRun: config.dryRun,
      durationMs,
    },
    config: {
      orders: config.orders,
      concurrency: config.concurrency,
      rateLimitPerSec: config.rateLimitPerSec,
      timelockSeconds: config.timelockSeconds,
    },
    summary: {
      totalOrders: results.length,
      filled,
      timedOut,
      failed,
      ethToXlm,
      xlmToEth,
      estimatedRpcCalls,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      maxDurationMs: durations[durations.length - 1] ?? 0,
    },
    failures: results
      .filter((r) => r.status === "failed")
      .map((r) => ({
        index: r.index,
        orderId: r.orderId,
        error: r.errorMessage ?? "unknown",
      })),
  };
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

export function toMarkdown(report: SoakReport): string {
  const { meta, config, summary } = report;
  const mode = meta.dryRun
    ? "**DRY-RUN** (no live RPC)"
    : "**LIVE** — Sepolia + Stellar testnet";

  const passRate =
    summary.totalOrders > 0
      ? (
          ((summary.filled + summary.timedOut) / summary.totalOrders) *
          100
        ).toFixed(1)
      : "0.0";

  const lines: string[] = [
    `# OverSync Soak-Test Report`,
    ``,
    `| | |`,
    `|---|---|`,
    `| **Mode** | ${mode} |`,
    `| **Timestamp** | \`${meta.timestamp}\` |`,
    `| **Seed** | \`${meta.seed}\` |`,
    `| **Total duration** | ${(meta.durationMs / 1000).toFixed(2)} s |`,
    ``,
    `## Configuration`,
    ``,
    `| Parameter | Value |`,
    `|---|---|`,
    `| Orders planned | ${config.orders} |`,
    `| Concurrency | ${config.concurrency} workers |`,
    `| Rate limit | ${config.rateLimitPerSec} orders / sec |`,
    `| Timelock | ${config.timelockSeconds} s |`,
    ``,
    `## Results`,
    ``,
    `| Metric | Count |`,
    `|---|---|`,
    `| Total orders | ${summary.totalOrders} |`,
    `| Filled | ${summary.filled} |`,
    `| Timed-out (refunded) | ${summary.timedOut} |`,
    `| Failed | ${summary.failed} |`,
    `| Pass rate | ${passRate} % |`,
    ``,
    `## Direction mix`,
    ``,
    `| Direction | Count |`,
    `|---|---|`,
    `| ETH → XLM | ${summary.ethToXlm} |`,
    `| XLM → ETH | ${summary.xlmToEth} |`,
    ``,
    `## Estimated RPC load`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Total estimated calls | ${summary.estimatedRpcCalls} |`,
    `| Calls per order (avg) | ${summary.totalOrders > 0 ? (summary.estimatedRpcCalls / summary.totalOrders).toFixed(1) : 0} |`,
    ``,
    `> **Note:** fill = 4 calls (fund + claim on each chain);`,
    `> timeout = 3 calls (fund + refund on the initiating chain + 1 timelock poll).`,
    ``,
    `## Latency (per-order processing time)`,
    ``,
    `| Percentile | Duration |`,
    `|---|---|`,
    `| p50 | ${summary.p50DurationMs} ms |`,
    `| p95 | ${summary.p95DurationMs} ms |`,
    `| max | ${summary.maxDurationMs} ms |`,
  ];

  if (summary.failed > 0) {
    lines.push(``, `## Failures`, ``);
    lines.push(`| Index | Order ID | Error |`);
    lines.push(`|---|---|---|`);
    for (const f of report.failures.slice(0, 50)) {
      lines.push(`| ${f.index} | \`${f.orderId}\` | ${f.error} |`);
    }
    if (report.failures.length > 50) {
      lines.push(
        ``,
        `_…and ${report.failures.length - 50} more. See the JSON report for the full list._`
      );
    }
  }

  lines.push(
    ``,
    `---`,
    ``,
    `*Generated by the OverSync load-test harness.*`,
    `*Reproduce: \`LOAD_TEST_SEED=${meta.seed} pnpm --filter @oversync/e2e load-test\`*`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write to disk
// ---------------------------------------------------------------------------

export function writeReports(
  report: SoakReport,
  outputDir: string
): { jsonPath: string; mdPath: string } {
  mkdirSync(outputDir, { recursive: true });

  // e.g. 2026-06-24T14-30-00_oversync-soak-2026
  const ts = report.meta.timestamp
    .replace(/\.\d+Z$/, "Z")
    .replace(/[:.]/g, "-")
    .replace("T", "_");
  const seedSlug = report.meta.seed.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const base = `${ts}_${seedSlug}`;

  const jsonPath = join(outputDir, `${base}.json`);
  const mdPath = join(outputDir, `${base}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, toMarkdown(report) + "\n", "utf8");

  return { jsonPath, mdPath };
}
