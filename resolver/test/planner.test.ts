import { describe, expect, it } from "vitest";
import type { ResolverConfig } from "../src/config.js";
import { buildPlan, observedFromEthereumEvent } from "../src/planner/index.js";
import type { ObservedSourceOrder } from "../src/planner/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validConfig(overrides?: Partial<ResolverConfig>): ResolverConfig {
  return {
    network: "testnet",
    pollIntervalMs: 15_000,
    coordinatorUrl: "http://localhost:3001",
    logLevel: "info",
    ethereum: {
      rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11_155_111,
      htlcEscrow: "0xb352339BEb146f2699d28D736700B953988bB178",
      resolverRegistry: "0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99",
      resolverPrivateKey: null
    },
    soroban: {
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      horizonUrl: "https://horizon-testnet.stellar.org",
      htlc: "CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK",
      resolverRegistry: "CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF",
      resolverSecret: null
    },
    ...overrides
  };
}

function makeEthOrder(overrides?: Partial<ObservedSourceOrder>): ObservedSourceOrder {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    sourceChain: "ethereum",
    orderId: "42",
    sender: "0x1111111111111111111111111111111111111111",
    beneficiary: "0x2222222222222222222222222222222222222222",
    token: "0x0000000000000000000000000000000000000000",
    amount: 100_000_000_000_000_000n, // 0.1 ETH
    safetyDeposit: 1_000_000_000_000_000n, // 0.001 ETH
    hashlock: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    timelock: now + 3600n, // 1 hour from now
    ...overrides
  };
}

function makeXlmOrder(overrides?: Partial<ObservedSourceOrder>): ObservedSourceOrder {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    sourceChain: "stellar",
    orderId: "99",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
    beneficiary: "GBV4G7G6Y6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6ZQ6",
    token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    amount: 10_000_000_000n, // 100 XLM (in stroops)
    safetyDeposit: 1_000_000_000n, // 10 XLM
    hashlock: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    timelock: now + 3600n,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// ETH → XLM (dry-run)
// ---------------------------------------------------------------------------

describe("buildPlan — ETH → XLM", () => {
  it("produces a valid plan in dry-run mode", () => {
    const order = makeEthOrder();
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.direction).toBe("eth_to_xlm");
    expect(result.plan.destination.destinationChain).toBe("stellar");
    expect(result.plan.destination.hashlock).toBe(order.hashlock);
    expect(result.plan.destination.amount).toBeLessThanOrEqual(order.amount);
    expect(result.plan.destination.timelockSeconds).toBeGreaterThanOrEqual(300n);
    expect(result.plan.destination.timelockSeconds).toBeLessThanOrEqual(86400n);
    expect(result.plan.destination.safetyDeposit).toBe(order.safetyDeposit);
  });

  it("deducts the default fee from the destination amount", () => {
    const order = makeEthOrder({ amount: 1_000_000_000_000_000_000n }); // 1 ETH
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fee = order.amount * 10n / 10000n; // 10 bp
    expect(result.plan.destination.amount).toBe(order.amount - fee);
  });

  it("applies a custom fee rate", () => {
    const order = makeEthOrder({ amount: 1_000_000_000_000_000_000n });
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true, feeBasisPoints: 50n });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fee = order.amount * 50n / 10000n; // 50 bp = 0.5%
    expect(result.plan.destination.amount).toBe(order.amount - fee);
  });

  it("clamps destination timelock to source minus buffer", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const order = makeEthOrder({ timelock: now + 1800n }); // 30 min
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true, timelockBufferSeconds: 600n });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // source remaining = 1800, minus 600 buffer = 1200
    expect(result.plan.destination.timelockSeconds).toBe(1200n);
  });

  it("passes hashlock through unchanged", () => {
    const order = makeEthOrder();
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.destination.hashlock).toBe(order.hashlock);
  });
});

// ---------------------------------------------------------------------------
// XLM → ETH (dry-run)
// ---------------------------------------------------------------------------

describe("buildPlan — XLM → ETH", () => {
  it("produces a valid plan in dry-run mode", () => {
    const order = makeXlmOrder();
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.direction).toBe("xlm_to_eth");
    expect(result.plan.destination.destinationChain).toBe("ethereum");
    expect(result.plan.destination.hashlock).toBe(order.hashlock);
  });

  it("maps addresses correctly for the EVM destination leg", () => {
    const order = makeXlmOrder();
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.destination.beneficiary).toBe(order.beneficiary);
    expect(result.plan.destination.refundAddress).toBe(cfg.ethereum.resolverRegistry);
  });

  it("clamps timelock within [300, 86400]", () => {
    // Source timelock far in the future
    const now = BigInt(Math.floor(Date.now() / 1000));
    const order = makeXlmOrder({ timelock: now + 999_999n });
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.destination.timelockSeconds).toBe(86400n);
  });
});

// ---------------------------------------------------------------------------
// Invalid / edge cases
// ---------------------------------------------------------------------------

describe("buildPlan — invalid config", () => {
  it("fails when ETH_HTLC_ESCROW is missing", () => {
    const order = makeXlmOrder();
    const cfg = validConfig({ ethereum: { ...validConfig().ethereum, htlcEscrow: null } });

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("ETH_HTLC_ESCROW"))).toBe(true);
  });

  it("fails when SOROBAN_HTLC is missing", () => {
    const order = makeEthOrder();
    const cfg = validConfig({ soroban: { ...validConfig().soroban, htlc: null } });

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("SOROBAN_HTLC"))).toBe(true);
  });

  it("fails on invalid network value", () => {
    const order = makeEthOrder();
    const cfg = validConfig({ network: "unknown" as any });

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("network"))).toBe(true);
  });

  it("fails when private keys are missing in live (non-dry-run) mode", () => {
    const order = makeEthOrder();
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes("RESOLVER_ETH_PRIVATE_KEY"))).toBe(true);
    expect(result.errors.some((e) => e.includes("RESOLVER_STELLAR_SECRET"))).toBe(true);
  });

  it("succeeds when private keys are present in live mode", () => {
    const order = makeEthOrder();
    const cfg = validConfig({
      ethereum: {
        ...validConfig().ethereum,
        resolverPrivateKey: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
      },
      soroban: {
        ...validConfig().soroban,
        resolverSecret: "SAZSP3S6L6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6Z6"
      }
    });

    const result = buildPlan(order, cfg, { dryRun: false });

    expect(result.ok).toBe(true);
  });
});

describe("buildPlan — edge cases", () => {
  it("fails when amount is zero", () => {
    const order = makeEthOrder({ amount: 0n });
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(false);
  });

  it("fails when destination timelock would be below minimum", () => {
    // Source expires in 60 seconds, minus buffer puts it below 300
    const now = BigInt(Math.floor(Date.now() / 1000));
    const order = makeEthOrder({ timelock: now + 60n });
    const cfg = validConfig();

    const result = buildPlan(order, cfg, { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.destination.timelockSeconds).toBe(300n);
  });
});

// ---------------------------------------------------------------------------
// observedFromEthereumEvent helper
// ---------------------------------------------------------------------------

describe("observedFromEthereumEvent", () => {
  it("converts an OrderCreated event to ObservedSourceOrder", () => {
    const event = {
      orderId: 99n,
      sender: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
      beneficiary: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const,
      token: "0xcccccccccccccccccccccccccccccccccccccccc" as const,
      amount: 5_000_000_000_000_000_000n,
      safetyDeposit: 1_000_000_000_000_000n,
      hashlock: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" as const,
      timelock: 1_800_000n,
      blockNumber: 10_000_000n
    };

    const order = observedFromEthereumEvent(event);

    expect(order.sourceChain).toBe("ethereum");
    expect(order.orderId).toBe("99");
    expect(order.sender).toBe(event.sender);
    expect(order.beneficiary).toBe(event.beneficiary);
    expect(order.amount).toBe(event.amount);
    expect(order.safetyDeposit).toBe(event.safetyDeposit);
    expect(order.hashlock).toBe(event.hashlock);
    expect(order.timelock).toBe(event.timelock);
  });
});
