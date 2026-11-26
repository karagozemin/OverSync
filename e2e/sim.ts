import { hashOrderPreimage } from "@oversync/sdk/secrets";

export type Hex = `0x${string}`;

export type OrderStatus = "Funded" | "Claimed" | "Refunded";

export interface CreateOrderInput {
  hashlock: Hex;
  timelockSeconds: number;
  /**
   * Address attempting the create. Required only when the registry gate
   * is enabled; used to look the sender up in the active-resolver set.
   */
  sender?: string;
}

export interface OrderView {
  id: bigint;
  hashlock: Hex;
  timelockAbsolute: number;
  status: OrderStatus;
  createdAt: number;
  finalisedAt: number;
  /** Amount locked in escrow for this order. */
  amount: bigint;
  /** Party that funded the order; refunded on expiry. */
  maker: string;
  /** Party that receives the escrow on claim. */
  recipient: string;
}

/** Default escrow amount used when a caller does not specify one. */
export const DEFAULT_ESCROW_AMOUNT = 1_000_000n;

/**
 * Faucet balance seeded for each party the first time it is referenced, so
 * that make/claim/refund flows can be asserted as real balance deltas without
 * the test having to pre-fund accounts.
 */
const PARTY_FAUCET = 1_000_000_000_000n;

const DEFAULT_MAKER = "maker";
const DEFAULT_RECIPIENT = "recipient";


export type SimErrorCode =
  | "InvalidHashlock"
  | "InvalidTimelock"
  | "OrderNotFound"
  | "OrderNotClaimable"
  | "OrderNotRefundable"
  | "InvalidPreimage"
  | "Expired"
  | "NotExpired"
  | "ResolverNotAuthorised";

export class SimError extends Error {
  constructor(public readonly code: SimErrorCode) {
    super(code);
    this.name = "SimError";
  }
}

export interface HtlcSim {
  readonly name: "evm" | "soroban";
  createOrder(input: CreateOrderInput): bigint;
  claimOrder(id: bigint, preimage: Hex): void;
  refundOrder(id: bigint): void;
  getOrder(id: bigint): OrderView;
  nextOrderId(): bigint;
  advanceTime(seconds: number): void;
  /**
   * Mirrors `HTLCEscrow`'s optional `ResolverRegistry`: when enabled,
   * only an active resolver may create an order. Claim and refund stay
   * permissionless regardless of registry state.
   */
  setRegistryEnabled(enabled: boolean): void;
  setResolverActive(resolver: string, active: boolean): void;
}

// Mirrors the [MIN_TIMELOCK, MAX_TIMELOCK] bounds enforced by both
// HTLCEscrow.sol and the Soroban htlc contract.
const MIN_TIMELOCK = 300;
const MAX_TIMELOCK = 24 * 60 * 60;

abstract class BaseHtlcSim {
  protected readonly orders = new Map<bigint, OrderView>();
  /** Escrow still locked per order id. */
  protected readonly escrow = new Map<bigint, bigint>();
  /** Per-party balances (makers and recipients). */
  protected readonly balances = new Map<string, bigint>();
  protected nextId = 1n;
  protected now: number;
  private registryEnabled = false;
  private readonly activeResolvers = new Set<string>();

  constructor() {
    this.now = Math.floor(Date.now() / 1000);
  }

  advanceTime(seconds: number): void {
    this.now += seconds;
  }

  setRegistryEnabled(enabled: boolean): void {
    this.registryEnabled = enabled;
  }

  setResolverActive(resolver: string, active: boolean): void {
    if (active) this.activeResolvers.add(resolver.toLowerCase());
    else this.activeResolvers.delete(resolver.toLowerCase());
  }

  nextOrderId(): bigint {
    return this.nextId;
  }

  createOrder(input: CreateOrderInput): bigint {
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.hashlock) || /^0x0+$/.test(input.hashlock)) {
      throw new SimError("InvalidHashlock");
    }
    if (input.timelockSeconds < MIN_TIMELOCK || input.timelockSeconds > MAX_TIMELOCK) {
      throw new SimError("InvalidTimelock");
    }
    if (this.registryEnabled) {
      const sender = input.sender?.toLowerCase();
      if (!sender || !this.activeResolvers.has(sender)) {
        throw new SimError("ResolverNotAuthorised");
      }
    }
    const id = this.nextId++;
    const amount = input.amount ?? DEFAULT_ESCROW_AMOUNT;
    const maker = input.maker ?? DEFAULT_MAKER;
    const recipient = input.recipient ?? DEFAULT_RECIPIENT;
    // Fund the order: debit the maker and lock the amount in escrow.
    this.ensureParty(maker);
    this.ensureParty(recipient);
    this.balances.set(maker, (this.balances.get(maker) ?? 0n) - amount);
    this.escrow.set(id, amount);
    this.orders.set(id, {
      id,
      hashlock: input.hashlock,
      timelockAbsolute: this.now + input.timelockSeconds,
      status: "Funded",
      createdAt: this.now,
      finalisedAt: 0,
      amount,
      maker,
      recipient
    });
    return id;
  }

  getOrder(id: bigint): OrderView {
    const o = this.orders.get(id);
    if (!o) throw new SimError("OrderNotFound");
    return { ...o };
  }

  protected getMutable(id: bigint): OrderView {
    const o = this.orders.get(id);
    if (!o) throw new SimError("OrderNotFound");
    return o;
  }

  refundOrder(id: bigint): void {
    const o = this.getMutable(id);
    if (o.status !== "Funded") throw new SimError("OrderNotRefundable");
    if (this.now <= o.timelockAbsolute) throw new SimError("NotExpired");
    o.status = "Refunded";
    o.finalisedAt = this.now;
    // Refund returns the locked escrow to the maker.
    this.releaseEscrow(o, o.maker);
  }

  /** Seed a party with the faucet balance the first time it is seen. */
  protected ensureParty(party: string): void {
    if (!this.balances.has(party)) this.balances.set(party, PARTY_FAUCET);
  }

  /** Move whatever is locked for `o` out of escrow and credit it to `to`. */
  protected releaseEscrow(o: OrderView, to: string): void {
    const locked = this.escrow.get(o.id) ?? 0n;
    this.escrow.set(o.id, 0n);
    this.ensureParty(to);
    this.balances.set(to, (this.balances.get(to) ?? 0n) + locked);
  }

  getBalance(party: string): bigint {
    return this.balances.get(party) ?? 0n;
  }

  getEscrowBalanceFor(id: bigint): bigint {
    return this.escrow.get(id) ?? 0n;
  }

  getEscrowBalance(): bigint {
    let total = 0n;
    for (const locked of this.escrow.values()) total += locked;
    return total;
  }
}

/**
 * Faithful re-encoding of HTLCEscrow.sol's order-bound claim logic.
 */
export class EvmHtlcSim extends BaseHtlcSim implements HtlcSim {
  readonly name = "evm" as const;

  claimOrder(id: bigint, preimage: Hex): void {
    const o = this.getMutable(id);
    if (o.status !== "Funded") throw new SimError("OrderNotClaimable");
    if (this.now > o.timelockAbsolute) throw new SimError("Expired");
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(preimage)) {
      throw new SimError("InvalidPreimage");
    }
    if (hashOrderPreimage(id, preimage) !== o.hashlock) {
      throw new SimError("InvalidPreimage");
    }
    o.status = "Claimed";
    o.finalisedAt = this.now;
    // A successful claim releases the escrow to the recipient.
    this.releaseEscrow(o, o.recipient);
  }
}

/**
 * Faithful re-encoding of the Soroban oversync-htlc claim branch. The
 * Soroban contract uses the same order-bound SHA-256 hashlock as EVM.
 */
export class SorobanHtlcSim extends BaseHtlcSim implements HtlcSim {
  readonly name = "soroban" as const;

  claimOrder(id: bigint, preimage: Hex): void {
    const o = this.getMutable(id);
    if (o.status !== "Funded") throw new SimError("OrderNotClaimable");
    if (this.now > o.timelockAbsolute) throw new SimError("Expired");
    if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(preimage)) {
      throw new SimError("InvalidPreimage");
    }
    if (hashOrderPreimage(id, preimage) !== o.hashlock) {
      throw new SimError("InvalidPreimage");
    }
    o.status = "Claimed";
    o.finalisedAt = this.now;
    // A successful claim releases the escrow to the recipient.
    this.releaseEscrow(o, o.recipient);
  }
}

// ── Cross-chain two-sided release invariant ───────────────────────────────────

/** Which finalisation is being checked across the two legs. */
export type ReleaseKind = "claim" | "refund";

/** The two sides of a cross-chain swap as modelled by the simulation. */
export type ChainSide = "evm" | "stellar";

/** One leg of a cross-chain swap: a fixture plus the order it holds. */
export interface CrossChainLeg {
  side: ChainSide;
  sim: HtlcSim;
  orderId: bigint;
}

/**
 * Thrown when a cross-chain finalisation released escrow on one side while the
 * other side is still holding it — i.e. a stuck bridge that a status-only check
 * would have reported as success.
 */
export class OneSidedReleaseError extends Error {
  constructor(
    public readonly lockedSide: ChainSide,
    public readonly kind: ReleaseKind
  ) {
    super(
      `cross-chain ${kind} released on one side only: ${lockedSide} escrow is still locked`
    );
    this.name = "OneSidedReleaseError";
  }
}

function expectedStatus(kind: ReleaseKind): OrderStatus {
  return kind === "claim" ? "Claimed" : "Refunded";
}

function isLegReleased(leg: CrossChainLeg, kind: ReleaseKind): boolean {
  const order = leg.sim.getOrder(leg.orderId);
  return (
    order.status === expectedStatus(kind) &&
    leg.sim.getEscrowBalanceFor(leg.orderId) === 0n
  );
}

/**
 * Assert that a cross-chain claim/refund released escrow on BOTH sides.
 *
 * Compares the escrow balance of each leg at the end of the operation: both
 * must have reached the expected terminal status with zero escrow still locked.
 * If exactly one side released, throws {@link OneSidedReleaseError} naming the
 * side that is still locked, so a single-sided fill can never be mistaken for a
 * successful bridge.
 */
export function assertEscrowReleasedTogether(
  legs: readonly [CrossChainLeg, CrossChainLeg],
  kind: ReleaseKind
): void {
  const locked = legs.filter((leg) => !isLegReleased(leg, kind)).map((leg) => leg.side);

  if (locked.length === legs.length) {
    throw new Error(
      `cross-chain ${kind} released on neither side (both ${locked.join(" and ")} escrow still locked)`
    );
  }
  if (locked.length === 1) {
    throw new OneSidedReleaseError(locked[0], kind);
  }
}
