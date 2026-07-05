import { Router } from "express";
import { z } from "zod";
import type { OrderRow, OrderSnapshot } from "../../persistence/orders-repo.js";
import { announceSchema, OrderService, OrderValidationError } from "../../services/order-service.js";
import { encodeCursor, decodeCursor } from "./cursor-utils.js";

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

export function ordersRoutes(orders: OrderService): Router {
  const router = Router();

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
        res.status(400).json({ error: "order_validation_error", message: err.message });
        return;
      }
      next(err);
    }
  });

  // IMPORTANT: Specific routes must come BEFORE parameterized routes
  router.get("/orders/history", async (req, res, next) => {
    const address = (req.query.address as string | undefined) ?? "";
    if (!address) {
      res.status(400).json({ error: "address_required" });
      return;
    }

    // Validate and parse limit
    const limitStr = req.query.limit as string | undefined;
    const limit = limitStr ? Number(limitStr) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      res.status(400).json({ error: "invalid_limit", message: "limit must be an integer between 1 and 200" });
      return;
    }

    // Validate and decode cursor (optional)
    let offset = 0;
    const cursorStr = req.query.cursor as string | undefined;
    if (cursorStr) {
      const decoded = decodeCursor(cursorStr);
      if (!decoded) {
        res.status(400).json({ error: "invalid_cursor", message: "cursor is malformed or expired" });
        return;
      }
      offset = decoded.offset;
    }

    try {
      // Fetch limit + 1 to detect if more rows exist
      const list = await orders.history(address, limit + 1, offset);
      const hasMore = list.length > limit;
      const rows = hasMore ? list.slice(0, limit) : list;

      // Generate next cursor if there are more rows
      let nextCursor: string | null = null;
      if (hasMore && rows.length > 0) {
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          nextCursor = encodeCursor({ offset: offset + limit, createdAt: lastRow.createdAt });
        }
      }

      res.json({
        transactions: rows.map((o) => serialiseOrder(o)).filter(Boolean),
        pagination: {
          limit,
          cursor: cursorStr ?? null,
          nextCursor,
          hasMore
        }
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/orders/snapshot", async (_req, res, next) => {
    try {
      const snapshots = await orders.getSnapshots();
      res.json({ snapshots });
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
        res.status(400).json({ error: "order_validation_error", message: err.message });
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
        res.status(400).json({ error: "order_validation_error", message: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}