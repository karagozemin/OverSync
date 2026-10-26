import { Router, type Request } from "express";
import { z } from "zod";
import type { OrderRow, OrderSnapshot } from "../../persistence/orders-repo.js";
import { announceSchema, OrderService, OrderValidationError } from "../../services/order-service.js";
import {
  encodeHistoryCursor,
  validateHistoryCursor,
  type HistoryCursor
} from "./cursor-utils.js";

export interface OrdersRouteOptions {
  /**
   * Deployment network cursors are bound to. Defaults to `NETWORK_MODE`.
   * A cursor minted by a testnet coordinator is rejected on mainnet.
   */
  network?: "testnet" | "mainnet";
}

// Page-size contract is unchanged from the offset-based route this replaced;
// only the cursor semantics moved to a keyset.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function defaultNetwork(): "testnet" | "mainnet" {
  return process.env.NETWORK_MODE === "mainnet" ? "mainnet" : "testnet";
}

/**
 * The history route accepts the address as `address`, and also under `eth` /
 * `stellar` for clients that only ever hold one of the two.
 */
function readHistoryAddress(query: Request["query"]): string {
  const candidates = [query.address, query.eth, query.stellar];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate.trim() : "";
    if (value) return value;
  }
  return "";
}

function orderValidationResponse(err: OrderValidationError): { status: number; body: Record<string, unknown> } {
  // A refused lifecycle edge is a conflict with the stored order, not a bad
  // request: answer 409 with the stable failure code so clients can tell an
  // illegal transition apart from a malformed payload (issue #252).
  if (isTransitionRejection(err)) {
    return {
      status: 409,
      body: {
        error: "illegal_transition",
        code: err.code,
        from: err.from,
        to: err.to,
        action: err.action,
        message: err.message
      }
    };
  }
  if (err.code === "TIMELOCKS_REVERSED" || err.code === "GAP_TOO_SMALL") {
    return { status: 400, body: { error: "timelock_ordering_invalid", code: err.code } };
  }
  return { status: 400, body: { error: "order_validation_error", message: err.message } };
}


function serialiseOrder(order: OrderRow | null) {
  if (!order) return null;
  return {
    id: order.publicId,
    direction: order.direction,
    status: order.status,
    hashlock: order.hashlock,
    src: {
      chain: order.srcChain,
      address: order.srcAddress,
      asset: order.srcAsset,
      amount: order.srcAmount,
      safetyDeposit: order.srcSafetyDeposit,
      orderId: order.srcOrderId,
      lockTx: order.srcLockTx,
      lockBlock: order.srcLockBlock,
      timelock: order.srcTimelock
    },
    dst: {
      chain: order.dstChain,
      address: order.dstAddress,
      asset: order.dstAsset,
      amount: order.dstAmount,
      orderId: order.dstOrderId,
      lockTx: order.dstLockTx,
      lockBlock: order.dstLockBlock,
      timelock: order.dstTimelock
    },
    secret: {
      revealed: order.preimage !== null,
      preimage: order.preimage,
      revealedTx: order.secretRevealedTx
    },
    resolver: order.resolverAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

export function ordersRoutes(orders: OrderService, options: OrdersRouteOptions = {}): Router {
  const router = Router();
  const network = options.network ?? defaultNetwork();

  router.post("/orders/announce", async (req, res, next) => {
    try {
      const parsed = announceSchema.parse(req.body);
      const order = await orders.announce(parsed);
      res.status(201).json(serialiseOrder(order));
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "validation_error", details: err.errors });
        return;
      }
      if (err instanceof OrderValidationError) {
        const { status, body } = orderValidationResponse(err);
        res.status(status).json(body);
        return;
      }
      next(err);
    }
  });

  // IMPORTANT: Specific routes must come BEFORE parameterized routes
  router.get("/orders/snapshot", async (_req, res, next) => {
    try {
      const snapshots = await orders.getSnapshots();
      res.json({ snapshots });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/transitions", async (req, res, next) => {
    const id = req.params.id;
    try {
      const order = await orders.get(id);
      if (!order) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const transitions = await orders.getTransitions(id);
      // Refused attempts are part of the audit trail but are reported
      // separately: they never changed the order status.
      const rejectedTransitions = await orders.getRejectedTransitions(id);
      res.json({ transitions, rejectedTransitions });
    } catch (err) {
      next(err);
    }
  });

  // Refused transitions for an order, with their stable failure codes.
  router.get("/orders/:id/rejected-transitions", async (req, res, next) => {
    const id = req.params.id;
    try {
      const order = await orders.get(id);
      if (!order) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rejectedTransitions = await orders.getRejectedTransitions(id);
      res.json({ rejectedTransitions, status: order.status });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/:id/refund-eligibility", async (req, res, next) => {
    try {
      const order = await orders.get(req.params.id);
      if (!order) {
        res.status(404).json({ error: "not_found" });
        return;
      }

      const timelocks = {
        ethereum: order.srcChain === "ethereum" ? order.srcTimelock : order.dstTimelock,
        stellar: order.srcChain === "stellar" ? order.srcTimelock : order.dstTimelock
      };
      res.json(evaluateRefundEligibility(timelocks, Math.floor(Date.now() / 1000)));
    } catch (err) {
      next(err);
    }
  });
  router.get("/orders/history", async (req, res, next) => {
    const address = readHistoryAddress(req.query);
    if (!address) {
      res.status(400).json({ error: "address_required" });
      return;
    }

    // A client that declares its network must be talking to a coordinator
    // running on that network. History rows are not comparable across them.
    const declaredNetwork = req.query.network;
    if (declaredNetwork !== undefined && declaredNetwork !== network) {
      res.status(400).json({
        error: "network_mismatch",
        message: `This coordinator serves ${network}, not ${String(declaredNetwork)}`
      });
      return;
    }

    const rawLimit = req.query.limit === undefined ? DEFAULT_LIMIT : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
      res.status(400).json({
        error: "invalid_limit",
        message: `limit must be an integer between 1 and ${MAX_LIMIT}`
      });
      return;
    }
    const limit = rawLimit;

    // The cursor is the only thing that decides where page N+1 starts. It is
    // validated against this request before it can reach the query layer, so a
    // cursor from another user or another network is a hard error rather than
    // a silently short page.
    let before: Pick<HistoryCursor, "createdAt" | "publicId"> | undefined;
    const cursorParam = req.query.cursor;
    if (cursorParam !== undefined) {
      const validation = validateHistoryCursor(cursorParam, { user: address, network });
      if (!validation.ok) {
        res.status(400).json({ error: "invalid_cursor", reason: validation.reason, message: validation.message });
        return;
      }
      before = { createdAt: validation.cursor.createdAt, publicId: validation.cursor.publicId };
    }

    try {
      // Fetch one extra row to learn whether another page exists. Guessing from
      // `count === limit` would leave a "Load More" button pointing at an
      // empty page.
      const rows = await orders.history(address, limit + 1, before);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      const nextCursor =
        hasMore && last
          ? encodeHistoryCursor({
              createdAt: last.createdAt,
              publicId: last.publicId,
              user: address,
              network
            })
          : null;

      res.json({
        transactions: page.map((o) => serialiseOrder(o)).filter(Boolean),
        pagination: { limit, count: page.length, hasMore, nextCursor }
      });
    } catch (err) {
      next(err);
    }
  });
  // Parameterized routes come AFTER specific routes
router.get("/orders/:id", async (req, res, next) => {
    const id = req.params.id;
    try {
      const order = await orders.get(id);
      if (!order) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json(serialiseOrder(order));
    } catch (err) {
      next(err);
    }
  });

  const lockSchema = z.object({
    orderId: z.string().min(1),
    txHash: z.string().min(1),
    blockNumber: z.coerce.number().int().nonnegative(),
    timelock: z.coerce.number().int().nonnegative()
  });

  router.post("/orders/:id/src-locked", async (req, res, next) => {
    try {
      const body = lockSchema.parse(req.body);
      await orders.recordSrcLock({ publicId: req.params.id, ...body });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "validation_error", details: err.errors });
        return;
      }
      if (err instanceof OrderValidationError) {
        const { status, body } = orderValidationResponse(err);
        res.status(status).json(body);
        return;
      }
      next(err);
    }
  });

  router.post("/orders/:id/dst-locked", async (req, res, next) => {
    try {
      const body = lockSchema.extend({ resolver: z.string().nullable().optional() }).parse(req.body);
      await orders.recordDstLock({
        publicId: req.params.id,
        orderId: body.orderId,
        txHash: body.txHash,
        blockNumber: body.blockNumber,
        timelock: body.timelock,
        resolver: body.resolver ?? null
      });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "validation_error", details: err.errors });
        return;
      }
      if (err instanceof OrderValidationError) {
        const { status, body } = orderValidationResponse(err);
        res.status(status).json(body);
        return;
      }
      next(err);
    }
  });

  return router;
}