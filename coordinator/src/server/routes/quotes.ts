import { Router } from "express";
import { QuoteExpiredError, QuoteNotFoundError } from "../../services/quote-service.js";
import type { QuoteService } from "../../services/quote-service.js";

export function quotesRoutes(quotes: QuoteService): Router {
  const router = Router();

  /**
   * GET /api/quotes/eth-xlm
   * Returns a freshly-issued (or cache-reissued) price quote for the
   * ETH→XLM pair.  Every response carries a unique `quoteId` that
   * resolvers reference when submitting fills; `expiresAt` is the
   * deterministic deadline enforced by `assertFresh`.
   */
  router.get("/quotes/eth-xlm", async (_req, res, next) => {
    try {
      const quote = await quotes.quoteEthXlm();
      res.json({
        quoteId: quote.quoteId,
        pair: quote.pair,
        ethUsd: quote.srcUsd,
        xlmUsd: quote.dstUsd,
        source: quote.source,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
        /** Convenience: milliseconds remaining until expiry (negative when expired). */
        freshMs: quote.expiresAt - Date.now()
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/quotes/:id/status
   * Check whether a previously issued quote is still fresh.
   * Resolvers can call this before submitting fills to avoid
   * wasting gas on an already-expired quote.
   *
   * 200 → fresh, body includes quote metadata + `freshMs`
   * 410 → expired, body explains the staleness
   * 404 → unknown quoteId
   */
  router.get("/quotes/:id/status", (req, res) => {
    const { id } = req.params;
    try {
      const quote = quotes.assertFresh(id);
      res.json({
        quoteId: quote.quoteId,
        fresh: true,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
        freshMs: quote.expiresAt - Date.now(),
        source: quote.source
      });
    } catch (err) {
      if (err instanceof QuoteExpiredError) {
        res.status(410).json({
          error: "quote_expired",
          quoteId: id,
          fresh: false,
          expiredMs: err.expiredMs,
          staleMs: Date.now() - err.expiredMs,
          message: err.message
        });
        return;
      }
      if (err instanceof QuoteNotFoundError) {
        res.status(404).json({
          error: "quote_not_found",
          quoteId: id,
          message: err.message
        });
        return;
      }
      throw err;
    }
  });

  return router;
}
