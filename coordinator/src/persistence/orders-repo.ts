import { randomBytes } from "node:crypto";
import { toStorageError, type Database } from "./db.js";
import type {
  OrderFailureCode,
  OrderTransitionAction
} from "../state-machine/order-machine.js";

type DatabaseT = Database;
type Statement = ReturnType<DatabaseT["prepare"]>;
type StatementResult = { changes: number; lastInsertRowid: number };
type AsyncCapableStatement = Statement & {
  runAsync?: (...params: any[]) => Promise<StatementResult>;
  getAsync?: (...params: any[]) => Promise<unknown>;
  allAsync?: (...params: any[]) => Promise<unknown[]>;
};

export interface OrderSnapshot {
  orderId: string;
  currentState: OrderStatus;
  transitions: string[];
  publicTxHashes: string[];
  timestamps: {
    createdAt: number;
    updatedAt: number;
  };
  direction: Direction;
  outcomeSummary: string;
}

export type OrderStatus =
  | "announced"
  | "src_locked"
  | "dst_locked"
  | "secret_revealed"
  | "completed"
  | "refunded"
  | "failed"
  | "expired";

export type Chain = "ethereum" | "stellar";
/** Listener identity: the Stellar side is observed through Soroban RPC. */
export type ChainName = "ethereum" | "soroban";

export interface ChainCursor {
  chain: ChainName;
  networkId: string;
  /** Last fully processed Ethereum block / Soroban ledger. */
  position: number;
  /** Opaque RPC pagination cursor (Soroban), if any. */
  cursor: string | null;
}
export type Direction = "eth_to_xlm" | "xlm_to_eth";

export interface OrderRow {
  id: number;
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
  fixture: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OrderMetrics {
  totalOrders: number;
  byStatus: Record<string, number>;
  completedOrders: number;
  refundedOrders: number;
  staleExpiredOrders: number;
  lastUpdatedTimestamp: number | null;
}

export interface OrderTransitionSummary {
  from: OrderStatus | null;
  to: OrderStatus;
  timestamp: number;
  txHash: string | null;
  category: string;
}

/**
 * A transition the state machine refused. Persisted so an operator can audit
 * who tried to move an order illegally and why the stored status did not
 * change (issue #252).
 */
export interface OrderRejectedTransition {
  from: OrderStatus;
  /** Status the writer tried to write. */
  to: OrderStatus;
  action: OrderTransitionAction | null;
  /** Stable machine-readable code — see `docs/API_ERRORS.md`. */
  code: OrderFailureCode;
  reason: string;
  txHash: string | null;
  /** Which writer refused it: `order-service`, `ethereum-listener`, … */
  writer: string;
  timestamp: number;
}

export interface RejectedTransitionInput {
  publicId: string;
  from: OrderStatus;
  to: OrderStatus;
  action: OrderTransitionAction | null;
  code: OrderFailureCode;
  reason: string;
  txHash?: string | null;
  writer?: string;
}

/** `order_events.event_type` used to persist refused transitions. */
export const TRANSITION_REJECTED_EVENT = "transition_rejected";

/** `order_events.event_type` used for applied transitions. */
export const TRANSITION_SUMMARY_EVENT = "transition_summary";

interface OrderEventDbRow {
  id: number;
  order_id: number;
  event_type: string;
  payload_json: string;
  created_at: number;
}
export interface AnnounceOrderInput {
  direction: Direction;
  hashlock: string;
  srcChain: Chain;
  srcAddress: string;
  srcAsset: string;
  srcAmount: string;
  srcSafetyDeposit: string;
  dstChain: Chain;
  dstAddress: string;
  dstAsset: string;
  dstAmount: string;
}

interface OrderDbRow {
  id: number;
  public_id: string;
  direction: Direction;
  status: OrderStatus;
  hashlock: string;
  src_chain: Chain;
  src_address: string;
  src_asset: string;
  src_amount: string;
  src_safety_deposit: string;
  src_order_id: string | null;
  src_lock_tx: string | null;
  src_lock_block: number | null;
  src_timelock: number | null;
  dst_chain: Chain;
  dst_address: string;
  dst_asset: string;
  dst_amount: string;
  dst_order_id: string | null;
  dst_lock_tx: string | null;
  dst_lock_block: number | null;
  dst_timelock: number | null;
  preimage: string | null;
  secret_revealed_tx: string | null;
  resolver_address: string | null;
  fixture: number;
  created_at: number;
  updated_at: number;
}

function rowToOrder(r: OrderDbRow): OrderRow {
  return {
    id: Number(r.id),
    publicId: r.public_id,
    direction: r.direction,
    status: r.status,
    hashlock: r.hashlock,
    srcChain: r.src_chain,
    srcAddress: r.src_address,
    srcAsset: r.src_asset,
    srcAmount: r.src_amount,
    srcSafetyDeposit: r.src_safety_deposit,
    srcOrderId: r.src_order_id,
    srcLockTx: r.src_lock_tx,
    srcLockBlock: r.src_lock_block,
    srcTimelock: r.src_timelock,
    dstChain: r.dst_chain,
    dstAddress: r.dst_address,
    dstAsset: r.dst_asset,
    dstAmount: r.dst_amount,
    dstOrderId: r.dst_order_id,
    dstLockTx: r.dst_lock_tx,
    dstLockBlock: r.dst_lock_block,
    dstTimelock: r.dst_timelock,
    preimage: r.preimage,
    secretRevealedTx: r.secret_revealed_tx,
    resolverAddress: r.resolver_address,
    fixture: Boolean(r.fixture),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export class OrdersRepository {
  private readonly insertStmt: Statement;
  private readonly insertFullStmt: Statement;
  private readonly byPublicId: Statement;
  private readonly byHashlock: Statement;
  private readonly byAddress: Statement;
  private readonly bySrcOrderId: Statement;
  private readonly byDstOrderId: Statement;
  private readonly byPreimage: Statement;
  private readonly insertOrderEvent: Statement;
  private readonly transitionsByOrderId: Statement;
  private readonly updateStatus: Statement;
  private readonly updateSrcLock: Statement;
  private readonly updateDstLock: Statement;
  private readonly updateSecret: Statement;
  private readonly completedOrderRows: Statement;
  private readonly metricsByStatus: Statement;
  private readonly metricsTotal: Statement;
  private readonly metricsLastUpdated: Statement;
    // Opt-in fixture reset/remove path (issue #161). Only ever returns rows
  // whose `fixture = 1` and is the only place those rows are deleted.
  private readonly countFixturesStmt: Statement;
  private readonly removeFixturesStmt: Statement;
  private readonly getCursorStmt: Statement;
  private readonly upsertCursorStmt: Statement;
  private readonly insertProcessedEventStmt: Statement;
  private readonly hasProcessedEventStmt: Statement;

  constructor(private readonly db: DatabaseT) {
    this.insertStmt = db.prepare(`
      INSERT INTO orders (
        public_id, direction, status, hashlock,
        src_chain, src_address, src_asset, src_amount, src_safety_deposit,
        dst_chain, dst_address, dst_asset, dst_amount
      ) VALUES (
        :publicId, :direction, 'announced', :hashlock,
        :srcChain, :srcAddress, :srcAsset, :srcAmount, :srcSafetyDeposit,
        :dstChain, :dstAddress, :dstAsset, :dstAmount
      )
    `);
    this.byPublicId = db.prepare("SELECT * FROM orders WHERE public_id = ?");
    this.byHashlock = db.prepare("SELECT * FROM orders WHERE hashlock = ?");
    // Keyset pagination. `created_at` is only second-resolution, so `public_id`
    // is the tiebreaker that makes the ordering total — without it, rows
    // sharing a second get dropped between pages or repeated. `OFFSET` is
    // deliberately not used: a row inserted mid-pagination would shift the
    // window and hide an existing order.
    this.byAddress = db.prepare(`
      SELECT * FROM orders
      WHERE (src_address = :addr OR dst_address = :addr)
        AND (
          :hasCursor = 0
          OR created_at < :cursorCreatedAt
          OR (created_at = :cursorCreatedAt AND public_id < :cursorPublicId)
        )
      ORDER BY created_at DESC, public_id DESC
      LIMIT :limit
    `);
    this.bySrcOrderId = db.prepare(`
      SELECT * FROM orders WHERE src_chain = :chain AND src_order_id = :orderId
    `);
    this.byDstOrderId = db.prepare(`
      SELECT * FROM orders WHERE dst_chain = :chain AND dst_order_id = :orderId
    `);
    this.byPreimage = db.prepare("SELECT * FROM orders WHERE preimage = ?");
    this.insertOrderEvent = db.prepare(`
      INSERT INTO order_events (order_id, event_type, payload_json)
      VALUES (:orderId, :eventType, :payloadJson)
    `);
    // Only applied transitions feed the public transition history — refused
    // attempts are persisted with their own event type (see below) so they
    // can be queried on their own without breaking existing consumers.
    this.transitionsByOrderId = db.prepare(`
      SELECT * FROM order_events
      WHERE order_id = :orderId AND event_type = :eventType
      ORDER BY created_at ASC, id ASC
    `);
    this.updateStatus = db.prepare(`
      UPDATE orders
      SET status = :status, updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE public_id = :publicId
    `);
    this.updateSrcLock = db.prepare(`
      UPDATE orders SET
        src_order_id = :orderId,
        src_lock_tx = :txHash,
        src_lock_block = :blockNumber,
        src_timelock = :timelock,
        status = CASE WHEN status = 'announced' THEN 'src_locked' ELSE status END,
        updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE public_id = :publicId
    `);
    this.updateDstLock = db.prepare(`
      UPDATE orders SET
        dst_order_id = :orderId,
        dst_lock_tx = :txHash,
        dst_lock_block = :blockNumber,
        dst_timelock = :timelock,
        resolver_address = :resolver,
        status = CASE WHEN status IN ('announced', 'src_locked') THEN 'dst_locked' ELSE status END,
        updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE public_id = :publicId
    `);
    this.insertFullStmt = db.prepare(`
      INSERT INTO orders (
        public_id, direction, status, hashlock,
        src_chain, src_address, src_asset, src_amount, src_safety_deposit,
        src_order_id, src_lock_tx, src_lock_block, src_timelock,
        dst_chain, dst_address, dst_asset, dst_amount,
        dst_order_id, dst_lock_tx, dst_lock_block, dst_timelock,
        preimage, secret_revealed_tx, resolver_address, fixture
      ) VALUES (
        :publicId, :direction, :status, :hashlock,
        :srcChain, :srcAddress, :srcAsset, :srcAmount, :srcSafetyDeposit,
        :srcOrderId, :srcLockTx, :srcLockBlock, :srcTimelock,
        :dstChain, :dstAddress, :dstAsset, :dstAmount,
        :dstOrderId, :dstLockTx, :dstLockBlock, :dstTimelock,
        :preimage, :secretRevealedTx, :resolverAddress, :fixture
      )
    `);
    this.updateSecret = db.prepare(`
      UPDATE orders SET
        preimage = :preimage,
        secret_revealed_tx = :txHash,
        status = 'secret_revealed',
        updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE public_id = :publicId
    `);
    this.completedOrderRows = db.prepare(`
      SELECT * FROM orders
      WHERE status IN ('completed', 'refunded', 'failed', 'expired')
      ORDER BY updated_at DESC
    `);
    this.metricsByStatus = db.prepare(
      "SELECT status, COUNT(*) as count FROM orders GROUP BY status"
    );
    this.metricsTotal = db.prepare(
      "SELECT COUNT(*) as count FROM orders"
    );
    this.metricsLastUpdated = db.prepare(
      "SELECT MAX(updated_at) as ts FROM orders"
    );
    this.countFixturesStmt = db.prepare(
      "SELECT COUNT(*) as count FROM orders WHERE fixture = 1"
    );
    this.removeFixturesStmt = db.prepare(
      "DELETE FROM orders WHERE fixture = 1"
    );
    this.getCursorStmt = db.prepare("SELECT * FROM chain_cursors WHERE chain = ?");
    // Monotonic: a stale writer can never move the cursor backwards, and a
    // write for a different network is a no-op (loadCursor rejects it first).
    this.upsertCursorStmt = db.prepare(`
      INSERT INTO chain_cursors (chain, network_id, position, cursor)
      VALUES (:chain, :networkId, :position, :cursor)
      ON CONFLICT (chain) DO UPDATE SET
        position = excluded.position,
        cursor = excluded.cursor,
        updated_at = CAST(strftime('%s','now') AS INTEGER)
      WHERE chain_cursors.network_id = excluded.network_id
        AND excluded.position >= chain_cursors.position
    `);
    this.insertProcessedEventStmt = db.prepare(`
      INSERT INTO processed_chain_events (event_key, chain, kind, position)
      VALUES (:eventKey, :chain, :kind, :position)
      ON CONFLICT (event_key) DO NOTHING
    `);
    this.hasProcessedEventStmt = db.prepare(
      "SELECT event_key FROM processed_chain_events WHERE event_key = ?"
    );
  }

  async getChainCursor(chain: ChainName): Promise<ChainCursor | null> {
    const row = await this.get<{
      chain: ChainName;
      network_id: string;
      position: number | string;
      cursor: string | null;
    }>(this.getCursorStmt, chain);
    if (!row) return null;
    return {
      chain: row.chain,
      networkId: row.network_id,
      position: Number(row.position),
      cursor: row.cursor ?? null
    };
  }

  async saveChainCursor(input: {
    chain: ChainName;
    networkId: string;
    position: number;
    cursor?: string | null;
  }): Promise<void> {
    await this.run(this.upsertCursorStmt, {
      chain: input.chain,
      networkId: input.networkId,
      position: input.position,
      cursor: input.cursor ?? null
    });
  }

  async hasProcessedEvent(eventKey: string): Promise<boolean> {
    return (await this.get(this.hasProcessedEventStmt, eventKey)) !== undefined;
  }

  /** Marks an event as applied. Returns false if it was already recorded. */
  async markEventProcessed(input: {
    eventKey: string;
    chain: ChainName;
    kind: string;
    position: number;
  }): Promise<boolean> {
    const result = await this.run(this.insertProcessedEventStmt, input);
    return result.changes === 1;
  }

  private async run(stmt: Statement, ...params: any[]): Promise<StatementResult> {
    try {
      const asyncStmt = stmt as AsyncCapableStatement;
      if (asyncStmt.runAsync) {
        return await asyncStmt.runAsync(...params);
      }
      const result = stmt.run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid)
      };
    } catch (error) {
      throw toStorageError(error);
    }
  }

  private async get<T>(stmt: Statement, ...params: any[]): Promise<T | undefined> {
    try {
      const asyncStmt = stmt as AsyncCapableStatement;
      if (asyncStmt.getAsync) {
        return ((await asyncStmt.getAsync(...params)) ?? undefined) as T | undefined;
      }
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      throw toStorageError(error);
    }
  }

  private async all<T>(stmt: Statement, ...params: any[]): Promise<T[]> {
    try {
      const asyncStmt = stmt as AsyncCapableStatement;
      if (asyncStmt.allAsync) {
        return (await asyncStmt.allAsync(...params)) as T[];
      }
      return stmt.all(...params) as T[];
    } catch (error) {
      throw toStorageError(error);
    }
  }

  /** Returns the public id of the new order. */
  async announce(input: AnnounceOrderInput): Promise<OrderRow> {
    const publicId = randomBytes(16).toString("hex");
    await this.run(this.insertStmt, { publicId, ...input });
    const row = await this.get<OrderDbRow>(this.byPublicId, publicId);
    if (!row) throw new Error("Failed to insert order");
    const order = rowToOrder(row);
    await this.recordTransition(order.id, null, "announced", null, "created");
    return order;
  }

  async findByPublicId(publicId: string): Promise<OrderRow | null> {
    const row = await this.get<OrderDbRow>(this.byPublicId, publicId);
    return row ? rowToOrder(row) : null;
  }

  async findByHashlock(hashlock: string): Promise<OrderRow | null> {
    const row = await this.get<OrderDbRow>(this.byHashlock, hashlock);
    return row ? rowToOrder(row) : null;
  }

  async findByPreimage(preimage: string): Promise<OrderRow | null> {
    const row = await this.get<OrderDbRow>(this.byPreimage, preimage);
    return row ? rowToOrder(row) : null;
  }

  async findBySrcOrderId(chain: Chain, orderId: string): Promise<OrderRow | null> {
    const row = await this.get<OrderDbRow>(this.bySrcOrderId, { chain, orderId });
    return row ? rowToOrder(row) : null;
  }

  async findByDstOrderId(chain: Chain, orderId: string): Promise<OrderRow | null> {
    const row = await this.get<OrderDbRow>(this.byDstOrderId, { chain, orderId });
    return row ? rowToOrder(row) : null;
  }

  /**
   * One page of an address's order history, newest first.
   *
   * Pass `before` to continue from a previous page's last row. Rows strictly
   * older than that keyset are returned, so an order inserted after the first
   * page was served cannot push an already-seen order off the end.
   */
  async findByAddressPage(
    addr: string,
    limit: number,
    before?: { createdAt: number; publicId: string }
  ): Promise<OrderRow[]> {
    const rows = await this.all<OrderDbRow>(this.byAddress, {
      addr,
      limit,
      hasCursor: before ? 1 : 0,
      cursorCreatedAt: before?.createdAt ?? 0,
      cursorPublicId: before?.publicId ?? ""
    });
    return rows.map(rowToOrder);
  }

  async getTransitions(publicId: string): Promise<OrderTransitionSummary[]> {
    const order = await this.findByPublicId(publicId);
    if (!order) return [];
    const rows = await this.all<OrderEventDbRow>(this.transitionsByOrderId, {
      orderId: order.id,
      eventType: TRANSITION_SUMMARY_EVENT
    });
    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as {
        from: OrderStatus | null;
        to: OrderStatus;
        txHash?: string | null;
        category?: string;
      };
      return {
        from: payload.from ?? null,
        to: payload.to,
        timestamp: Number(row.created_at),
        txHash: payload.txHash ?? null,
        category: payload.category ?? "transition"
      };
    });
  }

  async setStatus(
    publicId: string,
    status: OrderStatus,
    txHash: string | null = null
  ): Promise<void> {
    const order = await this.findByPublicId(publicId);
    if (!order) throw new Error("Unknown order");
    await this.run(this.updateStatus, { publicId, status });
    await this.recordTransition(order.id, order.status, status, txHash, status);
  }

  /**
   * Persist a refused transition without touching the order row: the stored
   * status stays exactly where it was (issue #252).
   */
  async recordRejectedTransition(input: RejectedTransitionInput): Promise<void> {
    const order = await this.findByPublicId(input.publicId);
    if (!order) throw new Error("Unknown order");
    await this.insertEvent(order.id, TRANSITION_REJECTED_EVENT, {
      from: input.from,
      to: input.to,
      action: input.action,
      code: input.code,
      reason: input.reason,
      txHash: input.txHash ?? null,
      writer: input.writer ?? "order-service"
    });
  }

  /** Refused transitions for an order, oldest first. */
  async getRejectedTransitions(publicId: string): Promise<OrderRejectedTransition[]> {
    const order = await this.findByPublicId(publicId);
    if (!order) return [];
    const rows = await this.all<OrderEventDbRow>(this.transitionsByOrderId, {
      orderId: order.id,
      eventType: TRANSITION_REJECTED_EVENT
    });
    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as Partial<OrderRejectedTransition>;
      return {
        from: payload.from as OrderStatus,
        to: payload.to as OrderStatus,
        action: payload.action ?? null,
        code: payload.code as OrderFailureCode,
        reason: payload.reason ?? "",
        txHash: payload.txHash ?? null,
        writer: payload.writer ?? "order-service",
        timestamp: Number(row.created_at)
      };
    });
  }

  /** Number of refused transitions recorded for an order. */
  async countRejectedTransitions(publicId: string): Promise<number> {
    return (await this.getRejectedTransitions(publicId)).length;
  }

  async recordSrcLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
  }): Promise<void> {
    const order = await this.findByPublicId(input.publicId);
    if (!order) throw new Error("Unknown order");
    await this.run(this.updateSrcLock, input);
    await this.recordTransition(order.id, order.status, "src_locked", input.txHash, "src_locked");
  }

  async recordDstLock(input: {
    publicId: string;
    orderId: string;
    txHash: string;
    blockNumber: number;
    timelock: number;
    resolver: string | null;
  }): Promise<void> {
    const order = await this.findByPublicId(input.publicId);
    if (!order) throw new Error("Unknown order");
    await this.run(this.updateDstLock, input);
    await this.recordTransition(order.id, order.status, "dst_locked", input.txHash, "dst_locked");
  }

  async recordSecretRevealed(input: {
    publicId: string;
    preimage: string;
    txHash: string;
  }): Promise<void> {
    const order = await this.findByPublicId(input.publicId);
    if (!order) throw new Error("Unknown order");
    await this.run(this.updateSecret, input);
    await this.recordTransition(order.id, order.status, "secret_revealed", input.txHash, "secret_revealed");
  }

  private async insertEvent(orderId: number, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await this.run(this.insertOrderEvent, {
      orderId,
      eventType,
      payloadJson: JSON.stringify(payload)
    });
  }

  private async recordTransition(
    orderId: number,
    from: OrderStatus | null,
    to: OrderStatus,
    txHash: string | null,
    category: string
  ): Promise<void> {
    await this.insertEvent(orderId, TRANSITION_SUMMARY_EVENT, {
      from,
      to,
      txHash,
      category
    });
  }

  async getMetrics(): Promise<OrderMetrics> {
    const byStatus = (await this.all<{ status: string; count: string }>(
      this.metricsByStatus
    )) as { status: string; count: string }[];
    const totalRow = (await this.get<{ count: string }>(this.metricsTotal)) as
      | { count: string }
      | undefined;
    const lastUpdatedRow = (await this.get<{ ts: number | null }>(
      this.metricsLastUpdated
    )) as { ts: number | null } | undefined;

    const byStatusMap: Record<string, number> = {};
    for (const r of byStatus) {
      byStatusMap[r.status] = Number(r.count);
    }

    const totalOrders = Number(totalRow?.count ?? 0);
    const completedOrders = byStatusMap["completed"] ?? 0;
    const refundedOrders = byStatusMap["refunded"] ?? 0;
    const staleExpiredOrders =
      (byStatusMap["expired"] ?? 0) + (byStatusMap["failed"] ?? 0);

    return {
      totalOrders,
      byStatus: byStatusMap,
      completedOrders,
      refundedOrders,
      staleExpiredOrders,
      lastUpdatedTimestamp: lastUpdatedRow?.ts ?? null
    };
  }

  async getCompletedOrderSnapshots(): Promise<OrderSnapshot[]> {
    const rows = await this.all<OrderDbRow>(this.completedOrderRows);
    return rows.map(rowToOrder).map(buildSnapshot);
  }

  /**
   * Insert a full order row directly (used by fixture seeding and tests).
   * Unlike announce(), this accepts all columns including status and
   * fixture flag. Does NOT record a transition event — callers can use
   * recordOrderTransition() for that.
   */
  async insertOrder(input: {
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
    fixture: boolean;
  }): Promise<OrderRow> {
    await this.run(this.insertFullStmt, { ...input, fixture: input.fixture ? 1 : 0 });
    const row = await this.get<OrderDbRow>(this.byPublicId, input.publicId);
    if (!row) throw new Error("Failed to insert order");
    return rowToOrder(row);
  }

  /** Count all fixture-flagged rows. */
  async countFixtures(): Promise<number> {
    const row = await this.get<{ count: number }>(this.countFixturesStmt);
    return Number(row?.count ?? 0);
  }

  /** Delete all fixture-flagged rows. Returns the number of deleted rows. */
  async removeFixtures(): Promise<number> {
    const result = await this.run(this.removeFixturesStmt);
    return result.changes;
  }

  /**
   * Record a transition event for an order identified by publicId.
   * Used by the demo-fixture seeder to build realistic state histories.
   */
  async recordOrderTransition(
    publicId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    txHash: string | null,
    category: string
  ): Promise<void> {
    const order = await this.findByPublicId(publicId);
    if (!order) throw new Error("Unknown order");
    await this.recordTransition(order.id, from, to, txHash, category);
  }
}

export function buildSnapshot(order: OrderRow): OrderSnapshot {
  const transitions = deriveTransitions(order.status);
  const publicTxHashes = [
    order.srcLockTx,
    order.dstLockTx,
    order.secretRevealedTx
  ].filter((tx): tx is string => tx !== null);
  const outcomeSummary = order.status === "completed" ? "Order completed successfully" :
                         order.status === "refunded" ? "Order refunded" :
                         order.status === "failed" ? "Order failed" :
                         "Order expired";

  return {
    orderId: order.publicId,
    currentState: order.status,
    transitions,
    publicTxHashes,
    timestamps: {
      createdAt: order.createdAt,
      updatedAt: order.updatedAt
    },
    direction: order.direction,
    outcomeSummary
  };
}

function deriveTransitions(status: OrderStatus): string[] {
  switch (status) {
    case "completed":
      return ["announced", "src_locked", "dst_locked", "secret_revealed", "completed"];
    case "refunded":
      return ["announced", "src_locked", "dst_locked", "secret_revealed", "refunded"];
    case "failed":
      return ["announced", "failed"];
    case "expired":
      return ["announced", "expired"];
    default:
      return [status];
  }
}
