import type { Logger } from "pino";
import {
  OrdersRepository,
  type Direction,
  type Chain,
  type OrderStatus
} from "./orders-repo.js";

const FIXTURE_ETH = "0xF1xturE111111111111111111111111111111111111";
const FIXTURE_STELLAR = "GDEMO11111111111111111111111111111111111111111111";
const FIXTURE_RESOLVER = "0xR3s0lv3r111111111111111111111111111111111111";
const FIXTURE_PREIMAGE = "0xf1xturepreimage1234567890abcdef1234567890abcdef1234567890abcd";

const VALID_HASHLOCK = "0x" + "a".repeat(64);

interface FixtureDef {
  publicId: string;
  direction: Direction;
  status: OrderStatus;
  hashlock: string;
  srcChain: Chain;
  srcAddress: string;
  srcAsset: string;
  srcAmount: string;
  srcSafetyDeposit: string;
  srcOrderId: string | null;
  srcLockTx: string | null;
  srcLockBlock: number | null;
  srcTimelock: number | null;
  dstChain: Chain;
  dstAddress: string;
  dstAsset: string;
  dstAmount: string;
  dstOrderId: string | null;
  dstLockTx: string | null;
  dstLockBlock: number | null;
  dstTimelock: number | null;
  preimage: string | null;
  secretRevealedTx: string | null;
  resolverAddress: string | null;
  transitions: Array<{
    from: OrderStatus | null;
    to: OrderStatus;
  }>;
}

const FIXTURES: FixtureDef[] = [
  {
    publicId: "demo-announced-001",
    direction: "eth_to_xlm",
    status: "announced",
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000001",
    srcChain: "ethereum",
    srcAddress: FIXTURE_ETH,
    srcAsset: "native",
    srcAmount: "500000000000000000",
    srcSafetyDeposit: "50000000000000000",
    srcOrderId: null,
    srcLockTx: null,
    srcLockBlock: null,
    srcTimelock: null,
    dstChain: "stellar",
    dstAddress: FIXTURE_STELLAR,
    dstAsset: "native",
    dstAmount: "50000000",
    dstOrderId: null,
    dstLockTx: null,
    dstLockBlock: null,
    dstTimelock: null,
    preimage: null,
    secretRevealedTx: null,
    resolverAddress: null,
    transitions: [
      { from: null, to: "announced" }
    ]
  },
  {
    publicId: "demo-src-locked-001",
    direction: "xlm_to_eth",
    status: "src_locked",
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000002",
    srcChain: "stellar",
    srcAddress: FIXTURE_STELLAR,
    srcAsset: "native",
    srcAmount: "75000000",
    srcSafetyDeposit: "7500000",
    srcOrderId: "stellar-order-001",
    srcLockTx: "stellar-lock-tx-001",
    srcLockBlock: 1_234_567,
    srcTimelock: Math.floor(Date.now() / 1000) + 86400,
    dstChain: "ethereum",
    dstAddress: FIXTURE_ETH,
    dstAsset: "native",
    dstAmount: "750000000000000000",
    dstOrderId: null,
    dstLockTx: null,
    dstLockBlock: null,
    dstTimelock: null,
    preimage: null,
    secretRevealedTx: null,
    resolverAddress: null,
    transitions: [
      { from: null, to: "announced" },
      { from: "announced", to: "src_locked" }
    ]
  },
  {
    publicId: "demo-dst-locked-001",
    direction: "eth_to_xlm",
    status: "dst_locked",
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000003",
    srcChain: "ethereum",
    srcAddress: FIXTURE_ETH,
    srcAsset: "native",
    srcAmount: "1000000000000000000",
    srcSafetyDeposit: "100000000000000000",
    srcOrderId: "eth-order-003",
    srcLockTx: "0xethtxlocksrc003",
    srcLockBlock: 15_000_000,
    srcTimelock: Math.floor(Date.now() / 1000) + 7200,
    dstChain: "stellar",
    dstAddress: FIXTURE_STELLAR,
    dstAsset: "native",
    dstAmount: "100000000",
    dstOrderId: "stellar-order-003",
    dstLockTx: "stellar-lock-tx-003",
    dstLockBlock: 1_234_890,
    dstTimelock: Math.floor(Date.now() / 1000) + 3600,
    preimage: null,
    secretRevealedTx: null,
    resolverAddress: FIXTURE_RESOLVER,
    transitions: [
      { from: null, to: "announced" },
      { from: "announced", to: "src_locked" },
      { from: "src_locked", to: "dst_locked" }
    ]
  },
  {
    publicId: "demo-completed-001",
    direction: "eth_to_xlm",
    status: "completed",
    hashlock: VALID_HASHLOCK,
    srcChain: "ethereum",
    srcAddress: FIXTURE_ETH,
    srcAsset: "native",
    srcAmount: "2000000000000000000",
    srcSafetyDeposit: "200000000000000000",
    srcOrderId: "eth-order-004",
    srcLockTx: "0xethtxlocksrc004",
    srcLockBlock: 15_001_000,
    srcTimelock: Math.floor(Date.now() / 1000) - 3600,
    dstChain: "stellar",
    dstAddress: FIXTURE_STELLAR,
    dstAsset: "native",
    dstAmount: "200000000",
    dstOrderId: "stellar-order-004",
    dstLockTx: "stellar-lock-tx-004",
    dstLockBlock: 1_235_100,
    dstTimelock: Math.floor(Date.now() / 1000) - 7200,
    preimage: FIXTURE_PREIMAGE,
    secretRevealedTx: "0xethsecretreveal004",
    resolverAddress: FIXTURE_RESOLVER,
    transitions: [
      { from: null, to: "announced" },
      { from: "announced", to: "src_locked" },
      { from: "src_locked", to: "dst_locked" },
      { from: "dst_locked", to: "secret_revealed" },
      { from: "secret_revealed", to: "completed" }
    ]
  },
  {
    publicId: "demo-refunded-001",
    direction: "xlm_to_eth",
    status: "refunded",
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000005",
    srcChain: "stellar",
    srcAddress: FIXTURE_STELLAR,
    srcAsset: "native",
    srcAmount: "30000000",
    srcSafetyDeposit: "3000000",
    srcOrderId: "stellar-order-005",
    srcLockTx: "stellar-lock-tx-005",
    srcLockBlock: 1_235_500,
    srcTimelock: Math.floor(Date.now() / 1000) - 86400,
    dstChain: "ethereum",
    dstAddress: FIXTURE_ETH,
    dstAsset: "native",
    dstAmount: "300000000000000000",
    dstOrderId: null,
    dstLockTx: null,
    dstLockBlock: null,
    dstTimelock: null,
    preimage: null,
    secretRevealedTx: null,
    resolverAddress: null,
    transitions: [
      { from: null, to: "announced" },
      { from: "announced", to: "src_locked" },
      { from: "src_locked", to: "refunded" }
    ]
  },
  {
    publicId: "demo-expired-001",
    direction: "eth_to_xlm",
    status: "expired",
    hashlock: "0x0000000000000000000000000000000000000000000000000000000000000006",
    srcChain: "ethereum",
    srcAddress: FIXTURE_ETH,
    srcAsset: "native",
    srcAmount: "400000000000000000",
    srcSafetyDeposit: "40000000000000000",
    srcOrderId: null,
    srcLockTx: null,
    srcLockBlock: null,
    srcTimelock: Math.floor(Date.now() / 1000) - 172800,
    dstChain: "stellar",
    dstAddress: FIXTURE_STELLAR,
    dstAsset: "native",
    dstAmount: "40000000",
    dstOrderId: null,
    dstLockTx: null,
    dstLockBlock: null,
    dstTimelock: null,
    preimage: null,
    secretRevealedTx: null,
    resolverAddress: null,
    transitions: [
      { from: null, to: "announced" },
      { from: "announced", to: "expired" }
    ]
  }
];

export async function seedDemoFixtures(
  repo: OrdersRepository,
  log: Logger
): Promise<void> {
  const existing = await repo.countFixtures();
  if (existing > 0) {
    log.info({ count: existing }, "Demo fixtures already seeded, skipping");
    return;
  }

  for (const def of FIXTURES) {
    const { transitions, ...orderData } = def;
    await repo.insertOrder({ ...orderData, fixture: true });
    for (const t of transitions) {
      await repo.recordOrderTransition(
        def.publicId,
        t.from,
        t.to,
        null,
        t.from === null ? "fixture_seeded" : t.to
      );
    }
    log.debug({ publicId: def.publicId, status: def.status }, "demo fixture seeded");
  }

  log.info({ count: FIXTURES.length }, "Demo fixtures seeded");
}
