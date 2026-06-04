import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { sepolia, mainnet } from "viem/chains";
import type { Logger } from "pino";
import type { CoordinatorConfig } from "../config.js";
import type { OrderService } from "../services/order-service.js";

const ORDER_CREATED = parseAbiItem(
  "event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed beneficiary, address token, uint256 amount, uint256 safetyDeposit, bytes32 hashlock, uint64 timelock)"
);
const ORDER_CLAIMED = parseAbiItem(
  "event OrderClaimed(uint256 indexed orderId, address indexed claimer, bytes32 preimage, uint256 amount, uint256 safetyDeposit)"
);
const ORDER_REFUNDED = parseAbiItem(
  "event OrderRefunded(uint256 indexed orderId, address indexed caller, uint256 amount, uint256 safetyDeposit)"
);

export class EthereumListener {
  private readonly client: PublicClient;
  private readonly log: Logger;
  private unwatchers: Array<() => void> = [];

  constructor(
    private readonly cfg: CoordinatorConfig,
    private readonly orders: OrderService,
    log: Logger
  ) {
    this.log = log.child({ component: "EthereumListener" });
    this.client = createPublicClient({
      chain: cfg.ethereum.chainId === 1 ? mainnet : sepolia,
      transport: http(cfg.ethereum.rpcUrl)
    });
  }

  start(): void {
    if (!this.cfg.ethereum.htlcEscrow) {
      this.log.warn("ETH_HTLC_ESCROW not configured - Ethereum listener disabled");
      return;
    }
    const address = this.cfg.ethereum.htlcEscrow;
    this.log.info({ contract: address }, "starting");

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_CREATED,
        onLogs: (logs) => {
          void (async () => {
            for (const log of logs) {
              const hashlock = log.args.hashlock!;
              try {
                const order = await this.orders.findByHashlock(hashlock);
                if (!order) {
                  this.log.info(
                    { hashlock, orderId: log.args.orderId?.toString() },
                    "ETH order observed without local announce"
                  );
                  continue;
                }
                await this.orders.recordSrcLock({
                  publicId: order.publicId,
                  orderId: log.args.orderId!.toString(),
                  txHash: log.transactionHash,
                  blockNumber: Number(log.blockNumber),
                  timelock: Number(log.args.timelock!)
                });
              } catch (err) {
                this.log.warn({ err, hashlock }, "could not record src lock");
              }
            }
          })();
        }
      })
    );

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_CLAIMED,
        onLogs: (logs) => {
          for (const log of logs) {
            this.log.info(
              { orderId: log.args.orderId!.toString(), preimage: log.args.preimage },
              "ETH order claimed"
            );
            // Secret reveal is recorded by SecretService when a client posts
            // /secrets/reveal. The listener could also push it forward if it
            // can match the on-chain order id to a coordinator order.
          }
        }
      })
    );

    this.unwatchers.push(
      this.client.watchEvent({
        address,
        event: ORDER_REFUNDED,
        onLogs: (logs) => {
          for (const log of logs) {
            this.log.info({ orderId: log.args.orderId!.toString() }, "ETH order refunded");
          }
        }
      })
    );
  }

  stop(): void {
    for (const u of this.unwatchers) u();
    this.unwatchers = [];
  }
}
