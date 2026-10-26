import { Router } from "express";
import { z } from "zod";
import type { SecretService } from "../../services/secret-service.js";
import type { RequestHandler } from "express";

export interface SecretsRoutesOptions {
  /** CORS middleware to gate the secret route. */
  cors?: RequestHandler;
  /** Readiness rate limit middleware to apply before JSON parsing. */
  rateLimit?: RequestHandler;
}

export function secretsRoutes(secrets: SecretService, options: SecretsRoutesOptions = {}): Router {
  const router = Router();

  const revealSchema = z.object({
    publicId: z.string().min(1),
    preimage: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "preimage must be 0x + 64 hex chars"),
    txHash: z.string().min(1)
  });

  const gates: RequestHandler[] = [];
  if (options.cors) gates.push(options.cors);
  if (options.rateLimit) gates.push(options.rateLimit);

  router.post("/secrets/reveal", ...gates, async (req, res, next) => {
    try {
      const body = revealSchema.parse(req.body);
      await secrets.reveal(body.publicId, body.preimage, body.txHash);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "validation_error", details: err.errors });
        return;
      }
      // The state machine refused the reveal: the order is not escrowed yet,
      // or it has already moved past the secret step (#252).
      if (isTransitionRejection(err)) {
        res.status(409).json({
          error: "illegal_transition",
          code: err.code,
          from: err.from,
          to: err.to,
          action: err.action,
          message: err.message
        });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: "secret_error", message: err.message });
        return;
      }
      next(err);
    }
  });

  router.get("/secrets/:publicId", async (req, res, next) => {
    try {
      const preimage = await secrets.get(req.params.publicId);
      if (!preimage) {
        res.status(404).json({ error: "not_revealed" });
        return;
      }
      res.json({ publicId: req.params.publicId, preimage });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
