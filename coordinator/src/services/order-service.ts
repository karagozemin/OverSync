import type { Logger } from "pino";
import { z } from "zod";
import {
  OrdersRepository,
  type OrderRow,
  type OrderSnapshot,
  type OrderRejectedTransition,
  type AnnounceOrderInput,
  type OrderMetrics,
  type OrderTransitionSummary,
  type Direction,
  type Chain,
  type OrderStatus
} from "../persistence/orders-repo.js";
import {
  ACTION_TARGET_STATUS,
  ORDER_FAILURE_CODES,
  actionForStatus,
  canTransition,
  describeTransitionFailure,
  evaluateTransition,
  type OrderFailureCode,
  type OrderTransitionAction
} from "../state-machine/order-machine.js";
import { illegalOrderTransitions, ordersTotal } from "../metrics.js";
import {
  QuoteService,
  QuoteExpiredError,
  QuoteNotFoundError,
  QuoteAmountMismatchError,
  QuoteTermsMismatchError
} from "./quote-service.js";
import { loadConfig } from "../config.js";
import {
  validateTimelocksAtCreation,
  type TimelockValidationError
} from "../utils/timelock-validator.js";

/**
 * Minimal interface the coordinator uses to verify that an Ethereum
 * address is currently registered in the on-chain ResolverRegistry.
 * Kept as a port so the service layer stays free of ethers / viem.
 */
export interface ResolverRegistryPort {
  /** Returns true if `address` is currently active in the registry. */
  isActive(address: string): Promise<boolean>;
}

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_HASHLOCK = "0x" + "0".repeat(64);
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

/** Writer label used when a caller does not identify itself. */
export const ORDER_SERVICE_WRITER = "order-service";

/** Page size used when a caller asks for history without naming a limit. */
const DEFAULT_HISTORY_LIMIT = 50;

export const announceSchema = z.object({
  direction: z.enum(["eth_to_xlm", "xlm_to_eth"]),
  hashlock: z.string().regex(HEX32, "hashlock must be 0x + 64 hex chars").refine(
    (v) => v.toLowerCase() !== ZERO_HASHLOCK.toLowerCase(),
    "hashlock must not be all zeros"
  ),
  srcChain: z.enum(["ethereum", "stellar"]),
  srcAddress: z.string(),
  srcAsset: z.string().min(1),
  srcAmount: z.string().regex(/^\d+$/, "srcAmount must be a decimal integer string"),
  srcSafetyDeposit: z.string().regex(/^\d+$/, "srcSafetyDeposit must be a decimal integer string"),
  dstChain: z.enum(["ethereum", "stellar"]),
  dstAddress: z.string(),
  dstAsset: z.string().min(1),
  dstAmount: z.string().regex(/^\d+$/, "dstAmount must be a decimal integer string"),
  /**
   * Optional: the `quoteId` returned by `GET /api/quotes/eth-xlm`.
   * When present, the coordinator validates that the quote has not
   * expired before accepting the announcement, ensuring fills cannot
   * be based on stale pricing.
   */
  quoteId: z.string().optional()
});

export type AnnounceInput = z.infer<typeof announceSchema>;

/**
 * Codes an `OrderValidationError` can carry: the timelock ordering codes and
 * the stable order state machine failure codes.
 */
export type OrderErrorCode =
  | TimelockValidationError
  | OrderFailureCode
  | "QUOTE_EXPIRED"
  | "QUOTE_NOT_FOUND"
  | "QUOTE_MISMATCH";

export class OrderValidationError extends Error {
  readonly code?: OrderErrorCode;

  constructor(message: string, code?: OrderErrorCode) {
    super(message);
    this.name = "OrderValidationError";
    this.code = code;
  }
}

function assertTimelocksAtCreation(
  srcTimelock: number,
  dstTimelock: number,
  minGapSeconds: number
): void {
  const validation = validateTimelocksAtCreation(srcTimelock, dstTimelock, minGapSeconds);
  if (!validation.isValid && validation.error) {
    const message =
      validation.error === "TIMELOCKS_REVERSED"
        ? "Destination timelock must be strictly before source timelock"
        : "Timelock gap between source and destination is below the minimum safety gap";
    throw new OrderValidationError(message, validation.error);
  }
}

/** A chain event was validly shaped but older than the persisted state. */
export class StaleOrderEventError extends OrderValidationError {
  constructor(message: string) {
    super(message);
    this.name = "StaleOrderEventError";
  }
}

export interface TransitionRejectionInfo {
  from: OrderStatus;
  to: OrderStatus;
  action: OrderTransitionAction | null;
  code: OrderFailureCode;
  reason: string;
  writer: string;
  publicId: string;
  txHash?: string | null;
}

/**
 * Thrown when a writer asks the coordinator to move an order along an edge the
 * state machine refuses. The attempt has already been persisted as a refused
 * transition at this point and the stored status is untouched.
 *
 * It extends `StaleOrderEventError` because a late chain event is exactly what
 * a rejected transition usually is, and existing callers rely on that.
 */
export class OrderTransitionRejectedError extends StaleOrderEventError {
  readonly code: OrderFailureCode;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly action: OrderTransitionAction | null;
  readonly writer: string;
  readonly publicId: string;

  constructor(info: TransitionRejectionInfo) {
    super(info.reason);
    this.name = "OrderTransitionRejectedError";
    this.code = info.code;
    this.from = info.from;
    this.to = info.to;
    this.action = info.action;
    this.writer = info.writer;
    this.publicId = info.publicId;
  }
}

/** True when the error is a refusal produced by the order state machine. */
export function isTransitionRejection(err: unknown): err is OrderTransitionRejectedError {
  return err instanceof OrderTransitionRejectedError;
}

function validateChainAddress(chain: Chain, addr: string): void {
  if (chain === "ethereum" && !HEX_ADDRESS.test(addr)) {
    throw new OrderValidationError(`${addr} is not a valid Ethereum address`);
  }
  if (chain === "stellar" && !STELLAR_ADDRESS.test(addr)) {
    throw new OrderValidationError(`${addr} is not a valid Stellar account`);
  }
}

function validateDirectionAgainstChains(input: AnnounceInput): void {
  const expected: Record<Direction, { src: Chain; dst: Chain }> = {
    eth_to_xlm: { src: "ethereum", dst: "stellar" },
    xlm_to_eth: { src: "stellar", dst: "ethereum" }
  };
  const want = expected[input.direction];
  if (want.src !== input.srcChain || want.dst !== input.dstChain) {
    throw new OrderValidationError(
      `Direction ${input.direction} requires src=${want.src} and dst=${want.dst}`
    );
  }
}

/**
 * One request to move an order along one legal edge.
 *
 * `advance()` is the only place the coordinator writes order status, so the
 * rule that decides whether an edge is legal (the state machine) is applied to
 * every writer: the order service itself, the HTTP routes that call it, the
 * secret service and both chain listeners.
 */
interface AdvanceRequest {
  publicId: string;
  action: OrderTransitionAction;
  txHash?: string | null;
  writer?: string;
  /**
   * When the order is already in the target status: does the incoming event
   * carry exactly the payload that is already stored? Identical payloads are
   * treated as an idempotent redelivery, anything else as a conflict.
   */
  isSameStep?: (order: OrderRow) => boolean;
  logMessage: string;
  logFields?: Record<string, unknown>;
  apply: (order: OrderRow, to: OrderStatus) => Promise<void>;
}

/**
 * The coordinator's single order writer. Every status change goes through
 * `advance()` so the order state machine is applied uniformly.
 */
export interface OrderService {
  announce(input: AnnounceInput): Promise<OrderRow>;
  get(publicId: string): Promise<OrderRow | null>;
  history(
    address: string,
    limit?: number,
    before?: { createdAt: number; publicId: string }
  ): Promise<OrderRow[]>;
  getTransitions(publicId: string): Promise<OrderTransitionSummary[]>;
  getRejectedTransitions(publicId: string): Promise<OrderRejectedTransition[]>;
  findByHashlock(hashlock: string): Promise<OrderRow | null>;
  findByPreimage(preimage: string): Promise<OrderRow | null>;
  findBySrcOrderId(chain: Chain, orderId: string): Promise<OrderRow | null>;
  findByDstOrderId(chain: Chain, orderId: string): Promise<OrderRow | null>;
  recordSrcLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    writer?: string;
  }): Promise<void>;
  recordDstLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    resolver: string | null;
    writer?: string;
  }): Promise<void>;
  recordSecret(
    publicId: string,
    preimage: string,
    txHash: string,
    writer?: string
  ): Promise<void>;
  recordClaim(input: { publicId: string; txHash: string; writer?: string }): Promise<void>;
  recordRefund(input: { publicId: string; txHash: string; writer?: string }): Promise<void>;
  getOrderMetrics(): Promise<OrderMetrics>;
  markStatus(publicId: string, status: OrderStatus, writer?: string): Promise<void>;
  getSnapshots(): Promise<OrderSnapshot[]>;
  buildClaim(orderId: string, resolverAddress: string): Promise<OrderRow>;
}

export class OrderService {
  private readonly minGapSeconds: number;

  constructor(
    private readonly repo: OrdersRepository,
    private readonly log: Logger,
    /** Optional — when supplied, quoteId in announce requests is validated. */
    private readonly quoteService?: QuoteService,
    config?: ReturnType<typeof loadConfig>,
    /** Optional — when supplied, buildClaim validates resolver registration. */
    private readonly resolverRegistry?: ResolverRegistryPort
  ) {
    this.minGapSeconds = config?.timelockSafetyGapSeconds ?? 600;
  }

  async announce(input: AnnounceInput): Promise<OrderRow> {
    const hashlock = input.hashlock.toLowerCase() as `0x${string}`;
    validateDirectionAgainstChains(input);
    validateChainAddress(input.srcChain, input.srcAddress);
    validateChainAddress(input.dstChain, input.dstAddress);

    // --- Quote freshness gate -------------------------------------------
    if (input.quoteId) {
      if (!this.quoteService) {
        // No QuoteService wired in (e.g. test mode without quotes) — skip.
        this.log.debug({ quoteId: input.quoteId }, "quoteId supplied but no QuoteService wired; skipping freshness check");
      } else {
        try {
          this.quoteService.bindOrderTerms(input.quoteId, {
            fromAsset: input.srcAsset,
            toAsset: input.dstAsset,
            amount: input.srcAmount,
            fromNetwork: input.srcChain,
            toNetwork: input.dstChain
          });
          // Amount binding: a quote issued with a bound amount only fills
          // an order that announces that exact srcAmount.
          this.quoteService.assertFresh(input.quoteId, input.srcAmount);
          this.log.debug({ quoteId: input.quoteId }, "quote freshness confirmed");
        } catch (err) {
          if (
            err instanceof QuoteExpiredError ||
            err instanceof QuoteNotFoundError ||
            err instanceof QuoteAmountMismatchError ||
            err instanceof QuoteTermsMismatchError
          ) {
            const code = err instanceof QuoteExpiredError
              ? "QUOTE_EXPIRED"
              : err instanceof QuoteNotFoundError
                ? "QUOTE_NOT_FOUND"
                : "QUOTE_MISMATCH";
            throw new OrderValidationError(err.message, code);
          }
          throw err;
        }
      }
    }
    // -------------------------------------------------------------------

    const existing = await this.repo.findByHashlock(hashlock);
    if (existing) {
      throw new OrderValidationError(
        `An order with hashlock ${hashlock} already exists (publicId=${existing.publicId})`
      );
    }

    // Strip quoteId — it's not a persisted column, just a freshness gate.
    const { quoteId: _q, ...repoInput } = input;
    const order = await this.repo.announce({ ...repoInput, hashlock } as AnnounceOrderInput);
    this.log.info(
      { publicId: order.publicId, direction: order.direction, quoteId: input.quoteId ?? null },
      "order announced"
    );
    ordersTotal.inc({ status: "announced" });
    return order;
  }

  get(publicId: string): Promise<OrderRow | null> {
    return this.repo.findByPublicId(publicId);
  }
  /**
   * Cursor-based history page. `before` is the validated keyset from the
   * previous page; omit it for the first page. `limit` defaults to a full page
   * so a bare `history(address)` still works for non-paginated callers.
   */
  history(
    address: string,
    limit = DEFAULT_HISTORY_LIMIT,
    before?: { createdAt: number; publicId: string }
  ): Promise<OrderRow[]> {
    return this.repo.findByAddressPage(address, limit, before);
  }

  getTransitions(publicId: string): Promise<OrderTransitionSummary[]> {
    return this.repo.getTransitions(publicId);
  }

  /**
   * Transitions the state machine refused for an order, with their stable
   * failure code. Queryable so an operator can see that a late listener event
   * or a repeated client call was refused and why the status did not move.
   */
  getRejectedTransitions(publicId: string): Promise<OrderRejectedTransition[]> {
    return this.repo.getRejectedTransitions(publicId);
  }

  findByHashlock(hashlock: string): Promise<OrderRow | null> {
    return this.repo.findByHashlock(hashlock);
  }

  findByPreimage(preimage: string): Promise<OrderRow | null> {
    return this.repo.findByPreimage(preimage);
  }

  /** Match an on-chain id that belongs to the order's source leg. */
  findBySrcOrderId(chain: Chain, orderId: string): Promise<OrderRow | null> {
    return this.repo.findBySrcOrderId(chain, orderId);
  }

  /** Match an on-chain id that belongs to the order's destination leg. */
  findByDstOrderId(chain: Chain, orderId: string): Promise<OrderRow | null> {
    return this.repo.findByDstOrderId(chain, orderId);
  }

  /** Source leg escrowed on chain (`escrow` edge). */
  async recordSrcLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    writer?: string;
  }): Promise<void> {
    await this.advance({
      publicId: input.publicId,
      action: "escrow",
      txHash: input.txHash,
      writer: input.writer,
      isSameStep: (order) =>
        order.srcOrderId === input.orderId &&
        order.srcLockTx === input.txHash &&
        order.srcLockBlock === input.blockNumber &&
        order.srcTimelock === input.timelock,
      logMessage: "src lock recorded",
      logFields: { srcOrderId: input.orderId },
      apply: async (order) => {
        if (order.dstTimelock != null) {
          assertTimelocksAtCreation(input.timelock, order.dstTimelock, this.minGapSeconds);
        }
        await this.repo.recordSrcLock({
          publicId: input.publicId,
          orderId: input.orderId,
          txHash: input.txHash,
          blockNumber: input.blockNumber,
          timelock: input.timelock
        });
      }
    });
  }

  /** Destination leg locked by a resolver (`secret_relay` edge). */
  async recordDstLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    resolver: string | null;
    writer?: string;
  }): Promise<void> {
    await this.advance({
      publicId: input.publicId,
      action: "secret_relay",
      txHash: input.txHash,
      writer: input.writer,
      isSameStep: (order) =>
        order.dstOrderId === input.orderId &&
        order.dstLockTx === input.txHash &&
        order.dstLockBlock === input.blockNumber &&
        order.dstTimelock === input.timelock &&
        order.resolverAddress === input.resolver,
      logMessage: "dst lock recorded",
      logFields: { dstOrderId: input.orderId },
      apply: async (order) => {
        if (order.srcTimelock != null) {
          assertTimelocksAtCreation(order.srcTimelock, input.timelock, this.minGapSeconds);
        }
        await this.repo.recordDstLock({
          publicId: input.publicId,
          orderId: input.orderId,
          txHash: input.txHash,
          blockNumber: input.blockNumber,
          timelock: input.timelock,
          resolver: input.resolver
        });
      }
    });
  }

  /**
   * Preimage relayed for an order (`secret` edge).
   *
   * The preimage is the identity of this step, the transaction hash is only
   * provenance: the same preimage can legitimately be relayed from a second
   * transaction (a claim observed on the other chain, an RPC retry, a re-org),
   * so re-relaying it is idempotent instead of a conflict.
   */
  async recordSecret(
    publicId: string,
    preimage: string,
    txHash: string,
    writer?: string
  ): Promise<void> {
    const canonical = preimage.toLowerCase();
    await this.advance({
      publicId,
      action: "secret",
      txHash,
      writer,
      isSameStep: (order) => order.preimage === canonical,
      logMessage: "secret recorded",
      apply: async () => {
        await this.repo.recordSecretRevealed({ publicId, preimage: canonical, txHash });
      }
    });
  }

  /**
   * The order was claimed on chain (`claim` edge).
   *
   * Refused unless the preimage has been recorded first — that is the guard
   * against a listener settling an order twice or settling one whose secret
   * the coordinator never saw.
   */
  async recordClaim(input: {
    publicId: string;
    txHash: string;
    writer?: string;
  }): Promise<void> {
    await this.advance({
      publicId: input.publicId,
      action: "claim",
      txHash: input.txHash,
      writer: input.writer,
      // A second claim for an order that is already completed is the same
      // settlement observed again — idempotent, never a second payout.
      isSameStep: () => true,
      logMessage: "claim recorded",
      apply: async () => {
        await this.repo.setStatus(input.publicId, "completed", input.txHash);
      }
    });
  }

  /** A refund was observed on chain (`refund` edge). */
  async recordRefund(input: {
    publicId: string;
    txHash: string;
    writer?: string;
  }): Promise<void> {
    await this.advance({
      publicId: input.publicId,
      action: "refund",
      txHash: input.txHash,
      writer: input.writer,
      isSameStep: () => true,
      logMessage: "refund recorded",
      apply: async () => {
        await this.repo.setStatus(input.publicId, "refunded", input.txHash);
      }
    });
  }

  async getOrderMetrics(): Promise<OrderMetrics> {
    return this.repo.getMetrics();
  }

  async markStatus(publicId: string, status: OrderStatus, writer?: string): Promise<void> {
    const action = actionForStatus(status);
    if (action === null) {
      throw new OrderValidationError(`${status} is not the target of a lifecycle edge`);
    }
    await this.advance({
      publicId,
      action,
      writer,
      logMessage: "status updated",
      apply: async () => {
        await this.repo.setStatus(publicId, status);
      }
    });
  }

  async getSnapshots(): Promise<OrderSnapshot[]> {
    return this.repo.getCompletedOrderSnapshots();
  }

  /**
   * Persist a refused transition and throw a typed error carrying its stable
   * code. The stored order status is never touched; only the audit trail
   * (`order_events`) grows.
   */
  private async rejectTransition(info: TransitionRejectionInfo): Promise<never> {
    await this.persistRejection(info);
    throw new OrderTransitionRejectedError(info);
  }

  /**
   * Record a refused transition in the audit trail: one `transition_rejected`
   * event, one metric sample, one log line. The order row is left alone.
   *
   * `noisy` is false for an identical redelivery, which is normal for chain
   * listeners and only worth a debug line (the metric still counts it).
   */
  private async persistRejection(
    info: TransitionRejectionInfo,
    { noisy = true }: { noisy?: boolean } = {}
  ): Promise<void> {
    await this.repo.recordRejectedTransition({
      publicId: info.publicId,
      from: info.from,
      to: info.to,
      action: info.action,
      code: info.code,
      reason: info.reason,
      txHash: info.txHash ?? null,
      writer: info.writer
    });
    illegalOrderTransitions.inc({ code: info.code });
    const fields = {
      publicId: info.publicId,
      from: info.from,
      to: info.to,
      action: info.action,
      code: info.code,
      writer: info.writer,
      txHash: info.txHash ?? null
    };
    if (noisy) {
      this.log.warn(fields, "refused illegal order transition");
    } else {
      this.log.debug(fields, "step already applied, refusing the repeat");
    }
  }

  /**
   * Apply one legal edge, refusing (and recording) anything else.
   *
   * Order of operations per event:
   *   1. load the order,
   *   2. if it is already in the target status, decide redelivery vs conflict,
   *   3. ask the state machine whether the edge is legal,
   *   4. only then write.
   */
  private async advance(request: AdvanceRequest): Promise<void> {
    const order = await this.repo.findByPublicId(request.publicId);
    if (!order) throw new OrderValidationError(`unknown order ${request.publicId}`);

    const to = ACTION_TARGET_STATUS[request.action];
    const writer = request.writer ?? ORDER_SERVICE_WRITER;

    if (order.status === to) {
      const redelivery = request.isSameStep ? request.isSameStep(order) : true;
      const code = redelivery
        ? ORDER_FAILURE_CODES.REPEATED_STEP
        : ORDER_FAILURE_CODES.CONFLICTING_STEP;
      const info: TransitionRejectionInfo = {
        publicId: request.publicId,
        from: order.status,
        to,
        action: request.action,
        code,
        reason: describeTransitionFailure(code, order.status, to),
        txHash: request.txHash ?? null,
        writer
      };
      if (redelivery) {
        // At-least-once delivery is normal for chain events: the step is
        // already applied, so record the repeat but neither move the order
        // nor fail the caller.
        await this.persistRejection(info, { noisy: false });
        return;
      }
      return this.rejectTransition(info);
    }

    const assessment = evaluateTransition(order.status, to, request.action);
    if (!assessment.allowed) {
      return this.rejectTransition({
        publicId: request.publicId,
        from: order.status,
        to,
        action: request.action,
        code: assessment.code ?? ORDER_FAILURE_CODES.NOT_ALLOWED,
        reason: assessment.reason ?? describeTransitionFailure(ORDER_FAILURE_CODES.NOT_ALLOWED, order.status, to),
        txHash: request.txHash ?? null,
        writer
      });
    }

    await request.apply(order, to);
    this.log.info(
      {
        publicId: order.publicId,
        from: order.status,
        to,
        action: request.action,
        writer,
        ...request.logFields
      },
      request.logMessage
    );
    ordersTotal.inc({ status: to });
  }

  /**
   * Validate that the coordinator may build a claim transaction for
   * `orderId` on behalf of `resolverAddress`.
   *
   * Throws `OrderValidationError` when:
   *  - The order does not exist or is not in a claimable state.
   *  - The resolver registry is configured and the resolver address is
   *    not currently active (never registered, or removed).
   *
   * Returns the order row so the caller can assemble the transaction
   * without a second DB round-trip.
   */
  async buildClaim(orderId: string, resolverAddress: string): Promise<OrderRow> {
    const order = await this.repo.findByPublicId(orderId);
    if (!order) throw new OrderValidationError(`unknown order ${orderId}`);

    if (order.status !== "dst_locked") {
      throw new OrderValidationError(
        `order ${orderId} is not in dst_locked state (current: ${order.status})`
      );
    }

    if (this.resolverRegistry) {
      const active = await this.resolverRegistry.isActive(resolverAddress);
      if (!active) {
        throw new OrderValidationError(
          `resolver ${resolverAddress} is not registered or has been removed from the registry`
        );
      }
      this.log.debug({ orderId, resolverAddress }, "resolver registry check passed");
    }

    return order;
  }
}

export class LegacyLockError extends Error {
  constructor() {
    super("legacy lock refused");
    this.name = "LegacyLockError";
  }
}

/** Use the v2 escrow when it is configured. A legacy-bridge target builds nothing. */
export function resolveLockTarget(input: {
  v2Escrow?: string | null;
  requestedTarget: string;
  legacyBridge: string;
}): { target: string } {
  const v2 = (input.v2Escrow ?? "").trim();
  if (!v2) return { target: input.requestedTarget };
  if (input.requestedTarget.toLowerCase() === input.legacyBridge.toLowerCase()) {
    throw new LegacyLockError();
  }
  return { target: v2 };
}