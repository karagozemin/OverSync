import { describe, it, expect } from "vitest";

import {
  FAILURE_CODE_CATALOG,
  type FailureCode
} from "../src/types/index.js";

// These imports go through the package.json `exports` map — not the
// `../src/...` shortcut used by the rest of the SDK's own tests.
// If the `exports."./types"` entry (or the `.` entry) silently resolves
// to a missing/empty file (e.g. a stale `dist/`), vitest returns
// `undefined` for the runtime value rather than throwing, which is
// exactly the failure mode seen when the coordinator's API error mapper
// and the frontend's TransactionHistory both broke against the
// "@oversync/sdk/types" subpath. Re-importing from both the package
// subpath and the main entry ensures every surface stays wired up.
import { FAILURE_CODE_CATALOG as SUBPATH_CATALOG } from "@oversync/sdk/types";
import {
  FAILURE_CODE_CATALOG as MAIN_CATALOG,
  type FailureCode as MainFailureCode
} from "@oversync/sdk";

// Snapshot of every entry the SDK ships today. A future change that
// adds or removes a code MUST update this list; that's the point —
// the test will then flag the regression explicitly instead of
// silently dropping the new code from consumer code paths.
const EXPECTED_CODES: FailureCode[] = [
  "ORDER_EXPIRED",
  "INSUFFICIENT_LIQUIDITY",
  "RESOLVER_TIMEOUT",
  "SETTLEMENT_REJECTED",
  "INVALID_SIGNATURE",
  "CHAIN_RPC_UNAVAILABLE",
  "VALIDATION_FAILED",
  "ORDER_NOT_FOUND",
  "INTERNAL_ERROR"
];

// Exhaustiveness sentinel: if `FailureCode` ever gains or loses a
// member, this `switch` forces tsc to flag the file at compile time,
// no runtime assertion required.
function assertFailureCodeExhaustive(code: FailureCode): string {
  switch (code) {
    case "ORDER_EXPIRED":
    case "INSUFFICIENT_LIQUIDITY":
    case "RESOLVER_TIMEOUT":
    case "SETTLEMENT_REJECTED":
    case "INVALID_SIGNATURE":
    case "CHAIN_RPC_UNAVAILABLE":
    case "VALIDATION_FAILED":
    case "ORDER_NOT_FOUND":
    case "INTERNAL_ERROR":
      return code;
    default: {
      // `never` here proves all union members are covered; adding a
      // new FailureCode will produce a tsc error at this line.
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

describe("@oversync/sdk exports surface", () => {
  it("exposes FAILURE_CODE_CATALOG with the expected set of codes", () => {
    // Guard before `Object.keys(...)`: if the package's `exports` map
    // ever silently resolves to `undefined` again (the original bug),
    // these `expect`s report a clean failure instead of throwing
    // `TypeError: Cannot convert undefined or null to object`.
    expect(SUBPATH_CATALOG).toBeDefined();
    expect(MAIN_CATALOG).toBeDefined();
    expect(FAILURE_CODE_CATALOG).toBeDefined();

    // Snapshot assertion (not just identity) so a future change that
    // accidentally drops or renames a code fails this test by value,
    // not by reference. Both the source import and the subpath import
    // must list the exact same set of keys.
    expect(Object.keys(SUBPATH_CATALOG).sort()).toEqual([...EXPECTED_CODES].sort());
    expect(Object.keys(MAIN_CATALOG).sort()).toEqual([...EXPECTED_CODES].sort());
    for (const code of EXPECTED_CODES) {
      expect(FAILURE_CODE_CATALOG[code]).toBeDefined();
      expect(FAILURE_CODE_CATALOG[code].code).toBe(code);
      expect(typeof FAILURE_CODE_CATALOG[code].message).toBe("string");
      expect(["user-actionable", "system-transient", "permanent"]).toContain(
        FAILURE_CODE_CATALOG[code].category
      );
    }
  });

  it("re-exposes the catalog at @oversync/sdk/types via the package exports map", () => {
    // Regression guard: previously the SDK's `exports."./types"` entry
    // pointed at `dist/types/index.js`, which silently resolved to
    // `undefined` when `dist/` had not been built (or was stale),
    // taking down both the coordinator's API error mapper and the
    // frontend's TransactionHistory component with a single shared
    // root cause.
    expect(SUBPATH_CATALOG).toBeDefined();
    expect(SUBPATH_CATALOG).toBe(FAILURE_CODE_CATALOG);
    expect(SUBPATH_CATALOG.VALIDATION_FAILED.message).toBe(
      "The order failed validation checks."
    );
    expect(SUBPATH_CATALOG.ORDER_NOT_FOUND.message).toBe(
      "The requested order could not be found."
    );
  });

  it("re-exposes the catalog through the main @oversync/sdk entry as well", () => {
    expect(MAIN_CATALOG).toBeDefined();
    expect(MAIN_CATALOG).toBe(FAILURE_CODE_CATALOG);
  });

  it("keeps the FailureCode type reachable and exhaustive through both surface paths", () => {
    // The value of `assertFailureCodeExhaustive` is purely *compile-time*:
    // its `const _exhaustive: never = code` line is what forces tsc to
    // error if `FailureCode` ever gains or loses a member. We still call
    // the helper at runtime so any future regression that loses its
    // exhaustiveness (e.g. someone replaces it with `as FailureCode`)
    // surfaces as a runtime no-op too, without needing a separate test.
    for (const code of EXPECTED_CODES) {
      assertFailureCodeExhaustive(code);
    }
    // Same check, but imported from the main entry — proving both
    // surface paths expose the same type, not just the same value.
    const fromMain: MainFailureCode = "VALIDATION_FAILED";
    assertFailureCodeExhaustive(fromMain);
  });
});
