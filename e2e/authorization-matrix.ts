import { generateSecret, hashOrderPreimage } from "@oversync/sdk/secrets";
import { SimError, type HtlcSim, type SimErrorCode } from "./sim.js";

/**
 * Shared authorization matrix for the EVM `HTLCEscrow` and the Soroban
 * `oversync-htlc`.
 *
 * Both contracts are two halves of one bridge: a rule that exists on
 * only one side lets the other side settle when it should not. This
 * module encodes every claim/refund outcome once and runs it against
 * both simulators (which re-encode the contracts' branch logic — see
 * `sim.ts`). `parity.test.ts` fails if the two result sets differ.
 *
 * Rows:
 *   registered resolver      | unregistered resolver
 *   correct preimage         | wrong preimage
 *   timelock open            | timelock expired
 *   already claimed          | already refunded
 */

export type OutcomeClass = "ok" | SimErrorCode;

export interface MatrixRow {
  id: string;
  description: string;
  /** The outcome both contracts must produce. */
  expected: OutcomeClass;
  run(sim: HtlcSim): OutcomeClass;
}

const TIMELOCK_SECONDS = 600;
const PAST_TIMELOCK = TIMELOCK_SECONDS + 1;

/** Run `fn`, mapping a contract-style revert to its stable error code. */
export function attempt(fn: () => void): OutcomeClass {
  try {
    fn();
    return "ok";
  } catch (err) {
    if (err instanceof SimError) return err.code;
    throw err;
  }
}

/** A deterministic active-resolver address per chain. */
export function resolverAddress(sim: HtlcSim): string {
  return sim.name === "evm"
    ? "0x0000000000000000000000000000000000001234"
    : "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
}

/** A deterministic non-resolver address per chain. */
export function strangerAddress(sim: HtlcSim): string {
  return sim.name === "evm"
    ? "0x0000000000000000000000000000000000005678"
    : "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
}

function newOrder(sim: HtlcSim, sender?: string): { id: bigint; preimage: `0x${string}` } {
  const secret = generateSecret();
  // The hashlock binds the order id before the order exists, exactly as
  // both on-chain contracts do with `nextOrderId()`.
  const id = sim.nextOrderId();
  const created = sim.createOrder({
    hashlock: hashOrderPreimage(id, secret.preimage),
    timelockSeconds: TIMELOCK_SECONDS,
    sender
  });
  return { id: created, preimage: secret.preimage };
}

function enableRegistry(sim: HtlcSim): string {
  const resolver = resolverAddress(sim);
  sim.setRegistryEnabled(true);
  sim.setResolverActive(resolver, true);
  return resolver;
}

export const MATRIX_ROWS: MatrixRow[] = [
  {
    id: "registered-resolver-creates",
    description: "an active registered resolver may create an order",
    expected: "ok",
    run: (sim) => {
      const resolver = enableRegistry(sim);
      return attempt(() => newOrder(sim, resolver));
    }
  },
  {
    id: "unregistered-resolver-creates",
    description: "an unregistered resolver may not create an order",
    expected: "ResolverNotAuthorised",
    run: (sim) => {
      enableRegistry(sim);
      return attempt(() => newOrder(sim, strangerAddress(sim)));
    }
  },
  {
    id: "claim-correct-preimage",
    description: "the correct preimage claims while the timelock is open",
    expected: "ok",
    run: (sim) => {
      const { id, preimage } = newOrder(sim);
      return attempt(() => sim.claimOrder(id, preimage));
    }
  },
  {
    id: "claim-wrong-preimage",
    description: "an unrelated preimage is rejected",
    expected: "InvalidPreimage",
    run: (sim) => {
      const { id } = newOrder(sim);
      const wrong = generateSecret();
      return attempt(() => sim.claimOrder(id, wrong.preimage));
    }
  },
  {
    id: "claim-after-timelock",
    description: "a claim after the timelock has expired is rejected",
    expected: "Expired",
    run: (sim) => {
      const { id, preimage } = newOrder(sim);
      sim.advanceTime(PAST_TIMELOCK);
      return attempt(() => sim.claimOrder(id, preimage));
    }
  },
  {
    id: "refund-before-timelock",
    description: "a refund before the timelock has expired is rejected",
    expected: "NotExpired",
    run: (sim) => {
      const { id } = newOrder(sim);
      return attempt(() => sim.refundOrder(id));
    }
  },
  {
    id: "refund-after-timelock",
    description: "a refund after the timelock has expired succeeds",
    expected: "ok",
    run: (sim) => {
      const { id } = newOrder(sim);
      sim.advanceTime(PAST_TIMELOCK);
      return attempt(() => sim.refundOrder(id));
    }
  },
  {
    id: "second-claim",
    description: "a second claim against an already-claimed order is rejected",
    expected: "OrderNotClaimable",
    run: (sim) => {
      const { id, preimage } = newOrder(sim);
      sim.claimOrder(id, preimage);
      return attempt(() => sim.claimOrder(id, preimage));
    }
  },
  {
    id: "second-refund",
    description: "a second refund against an already-refunded order is rejected",
    expected: "OrderNotRefundable",
    run: (sim) => {
      const { id } = newOrder(sim);
      sim.advanceTime(PAST_TIMELOCK);
      sim.refundOrder(id);
      return attempt(() => sim.refundOrder(id));
    }
  },
  {
    id: "refund-after-claim",
    description: "a refund against an already-claimed order is rejected",
    expected: "OrderNotRefundable",
    run: (sim) => {
      const { id, preimage } = newOrder(sim);
      sim.claimOrder(id, preimage);
      sim.advanceTime(PAST_TIMELOCK);
      return attempt(() => sim.refundOrder(id));
    }
  },
  {
    id: "claim-after-refund",
    description: "a claim against an already-refunded order is rejected",
    expected: "OrderNotClaimable",
    run: (sim) => {
      const { id, preimage } = newOrder(sim);
      sim.advanceTime(PAST_TIMELOCK);
      sim.refundOrder(id);
      return attempt(() => sim.claimOrder(id, preimage));
    }
  },
  {
    id: "unregistered-resolver-claims",
    description: "claim stays permissionless even when the registry gate is on",
    expected: "ok",
    run: (sim) => {
      const resolver = enableRegistry(sim);
      const { id, preimage } = newOrder(sim, resolver);
      return attempt(() => sim.claimOrder(id, preimage));
    }
  },
  {
    id: "unregistered-resolver-refunds",
    description: "refund stays permissionless even when the registry gate is on",
    expected: "ok",
    run: (sim) => {
      const resolver = enableRegistry(sim);
      const { id } = newOrder(sim, resolver);
      sim.advanceTime(PAST_TIMELOCK);
      return attempt(() => sim.refundOrder(id));
    }
  },
  {
    id: "unknown-order-claim",
    description: "claiming a non-existent order is rejected as not found",
    expected: "OrderNotFound",
    run: (sim) => attempt(() => sim.claimOrder(999n, generateSecret().preimage))
  },
  {
    id: "unknown-order-refund",
    description: "refunding a non-existent order is rejected as not found",
    expected: "OrderNotFound",
    run: (sim) => attempt(() => sim.refundOrder(999n))
  }
];

/**
 * Run every matrix row against a fresh simulator and return the outcome
 * per row id. Fresh state per row keeps the rows independent.
 */
export function runMatrix(
  factory: () => HtlcSim,
  rows: MatrixRow[] = MATRIX_ROWS
): Record<string, OutcomeClass> {
  const results: Record<string, OutcomeClass> = {};
  for (const row of rows) {
    results[row.id] = row.run(factory());
  }
  return results;
}
