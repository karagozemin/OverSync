import { Router } from "express";
import { z } from "zod";
import {
  AmountParseError,
  QuoteExpiredError,
  QuoteNotFoundError
} from "../../services/quote-service.js";
import type { QuoteService } from "../../services/quote-service.js";
import { validationErrorResponse } from "./validation-error.js";

const quoteTermsSchema = z
  .object({
    srcChain: z.enum(["ethereum", "stellar"]),
    srcAsset: z.string().min(1),
    srcAmount: z.string().regex(/^\d+$/),
    dstChain: z.enum(["ethereum", "stellar"]),
    dstAsset: z.string().min(1),
    dstAmount: z.string().regex(/^\d+$/)
  })
  .strict();

const QUOTE_TERM_KEYS = [
  "srcChain",
  "srcAsset",
  "srcAmount",
  "dstChain",
  "dstAsset",
  "dstAmount"
] as const;

/**
 * Strict query contract. Clients either send the whole set of terms or none of
 * them; `amount` may accompany either form. Any other query key (including a
 * misspelled term such as `srcAmout`) is rejected instead of ignored.
 */
const quoteQuerySchema = quoteTermsSchema
  .partial()
  .extend({ amount: z.string().optional() })
  .strict();

export function quotesRoutes(quotes: QuoteService): Router {
  const router = Router();

  /**
   * GET /api/quotes/eth-xlm
   * Returns a freshly-issued (or cache-reissued) price quote for the
   * ETH→XLM pair.  Every response carries a unique `quoteId` that
   * resolvers reference when submitting fills; `expiresAt` is the
   * deterministic deadline enforced by `assertFresh`.
   *
   * Optional `?amount=<base-unit integer>` binds the quote to that exact
   * source amount; an order announced with a different `srcAmount` is
   * then rejected. Decimal text is refused so the coordinator never
   * re-parses (and possibly rounds) what the form already parsed.
   */
  router.get("/quotes/eth-xlm", async (req, res, next) => {
    try {
      const rawAmount = req.query.amount;
      if (rawAmount !== undefined && typeof rawAmount !== "string") {
        res.status(400).json({ error: "invalid_amount", message: "amount must be a single value" });
        return;
      }
      const parsedQuery = quoteQuerySchema.parse(req.query);
      const hasTerms = QUOTE_TERM_KEYS.some((key) => parsedQuery[key] !== undefined);
      let quote;
      try {
        quote = await quotes.quoteEthXlm({
          ...(hasTerms
            ? quoteTermsSchema.parse({
                srcChain: parsedQuery.srcChain,
                srcAsset: parsedQuery.srcAsset,
                srcAmount: parsedQuery.srcAmount,
                dstChain: parsedQuery.dstChain,
                dstAsset: parsedQuery.dstAsset,
                dstAmount: parsedQuery.dstAmount
              })
            : {}),
          amountBaseUnits: parsedQuery.amount
        });
      } catch (err) {
        if (err instanceof AmountParseError) {
          res.status(400).json({ error: "invalid_amount", message: err.message });
          return;
        }
        throw err;
      }
      res.json({
        quoteId: quote.quoteId,
        pair: quote.pair,
        srcChain: quote.srcChain,
        srcAsset: quote.srcAsset,
        srcAmount: quote.srcAmount,
        dstChain: quote.dstChain,
        dstAsset: quote.dstAsset,
        dstAmount: quote.dstAmount,
        ethUsd: quote.srcUsd,
        xlmUsd: quote.dstUsd,
        source: quote.source,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt,
        amountBaseUnits: quote.amountBaseUnits ?? null,
        /** Convenience: milliseconds remaining until expiry (negative when expired). */
        freshMs: quote.expiresAt - Date.now()
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json(validationErrorResponse(err));
        return;
      }
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
        source: quote.source,
        ...quote.terms
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
