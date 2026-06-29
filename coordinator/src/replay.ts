import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia, mainnet } from "viem/chains";
import { rpc } from "@stellar/stellar-sdk";
import { z } from "zod";
import { loadConfig } from "./config.js";

const ORDER_CREATED = parseAbiItem(
  "event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed beneficiary, address token, uint256 amount, uint256 safetyDeposit, bytes32 hashlock, uint64 timelock)"
);
const ORDER_CLAIMED = parseAbiItem(
  "event OrderClaimed(uint256 indexed orderId, address indexed claimer, bytes32 preimage, uint256 amount, uint256 safetyDeposit)"
);
const ORDER_REFUNDED = parseAbiItem(
  "event OrderRefunded(uint256 indexed orderId, address indexed caller, uint256 amount, uint256 safetyDeposit)"
);

export const ReplayArgsSchema = z.object({
  chain: z.enum(["ethereum", "soroban"]),
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive()
});

export type ReplayArgs = z.infer<typeof ReplayArgsSchema>;

export type ReplaySummary = {
  chain: "ethereum" | "soroban";
  from: number;
  to: number;
  events: Record<string, number>;
  parseFailures: number;
};

export async function runReplay(args: ReplayArgs): Promise<ReplaySummary> {
  const cfg = loadConfig();
  const summary: ReplaySummary = {
    chain: args.chain,
    from: args.from,
    to: args.to,
    events: {},
    parseFailures: 0
  };

  if (args.chain === "ethereum") {
    const address = cfg.ethereum.htlcEscrow;
    if (!address) {
      throw new Error("ETH_HTLC_ESCROW not configured");
    }
    const client = createPublicClient({
      chain: cfg.ethereum.chainId === 1 ? mainnet : sepolia,
      transport: http(cfg.ethereum.rpcUrl)
    });

    try {
      const fromBlock = BigInt(args.from);
      const toBlock = BigInt(args.to);

      const [createdLogs, claimedLogs, refundedLogs] = await Promise.all([
        client.getLogs({ address, event: ORDER_CREATED, fromBlock, toBlock }).catch((e) => {
          summary.parseFailures++;
          return [];
        }),
        client.getLogs({ address, event: ORDER_CLAIMED, fromBlock, toBlock }).catch((e) => {
          summary.parseFailures++;
          return [];
        }),
        client.getLogs({ address, event: ORDER_REFUNDED, fromBlock, toBlock }).catch((e) => {
          summary.parseFailures++;
          return [];
        })
      ]);

      summary.events["OrderCreated"] = createdLogs.length;
      summary.events["OrderClaimed"] = claimedLogs.length;
      summary.events["OrderRefunded"] = refundedLogs.length;
    } catch (err) {
      summary.parseFailures++;
    }
  } else if (args.chain === "soroban") {
    const contractId = cfg.soroban.htlcContract;
    if (!contractId) {
      throw new Error("SOROBAN_HTLC contract not configured");
    }
    const server = new rpc.Server(cfg.soroban.rpcUrl, {
      allowHttp: cfg.soroban.rpcUrl.startsWith("http://")
    });

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      try {
        const events = await server.getEvents({
          filters: [{ type: "contract", contractIds: [contractId] }],
          startLedger: args.from,
          cursor,
          limit: 100
        });

        for (const ev of events.events) {
          if (ev.ledger > args.to) {
            hasMore = false;
            break;
          }
          if (ev.ledger >= args.from && ev.ledger <= args.to) {
            summary.events["ContractEvent"] = (summary.events["ContractEvent"] || 0) + 1;
          }
        }

        if (events.cursor && hasMore && events.events.length > 0) {
          cursor = events.cursor;
        } else {
          hasMore = false;
        }
      } catch (err) {
        summary.parseFailures++;
        hasMore = false;
      }
    }
  }

  return summary;
}

export async function main(argv: string[]) {
  const rawArgs: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const parts = arg.slice(2).split("=");
      const key = parts[0];
      if (key && parts.length >= 2) {
        rawArgs[key] = parts.slice(1).join("=");
      }
    }
  }

  try {
    const args = ReplayArgsSchema.parse(rawArgs);
    if (args.from > args.to) {
      throw new Error("fromBlock/ledger cannot be greater than toBlock/ledger");
    }
    const summary = await runReplay(args);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message || err.toString() }, null, 2));
    process.exit(1);
  }
}

// ESM entry point check
import { fileURLToPath } from 'url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv).catch(() => process.exit(1));
}
