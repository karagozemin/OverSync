import { Router } from "express";
import { registry } from "../../metrics.js";
import type { OrderService } from "../../services/order-service.js";

export function metricsRoutes(): Router {
  const router = Router();

  router.get("/metrics", async (_req, res) => {
    try {
      res.set("Content-Type", registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      res.status(500).end(String(err));
    }
  });

  return router;
}

export function orderMetricsRoutes(orders: OrderService): Router {
  const router = Router();

  router.get("/metrics", async (_req, res, next) => {
    try {
      const metrics = await orders.getOrderMetrics();
      res.json(metrics);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
