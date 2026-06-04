import { Router } from "express";
import { z } from "zod";
import type { SecretService } from "../../services/secret-service.js";

export function secretsRoutes(secrets: SecretService): Router {
  const router = Router();

  const revealSchema = z.object({
    publicId: z.string().min(1),
    preimage: z.string().regex(/^0x[0-9a-fA-F]+$/),
    txHash: z.string().min(1)
  });

  router.post("/secrets/reveal", async (req, res, next) => {
    try {
      const body = revealSchema.parse(req.body);
      await secrets.reveal(body.publicId, body.preimage, body.txHash);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "validation_error", details: err.errors });
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
