import { describe, expect, it } from "vitest";

import {
  convertAtomic,
  ETHEREUM_DECIMALS,
  formatAtomicToDecimal,
  isBridgeableWei,
  MAX_STELLAR_STROOPS,
  MIN_STELLAR_STROOPS,
  MIN_WEI_PER_STROOP,
  parseDecimalToAtomic,
  STELLAR_DECIMALS,
  stroopsToWei,
  weiToStroops,
} from "../src/amounts/index.js";

/** Unwraps a result, failing the test with the error code if it is not ok. */
function value<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) {
    throw new Error(`expected an exact conversion, got ${result.code}`);
  }
  return result.value;
}

describe("decimal parity between chains", () => {
  it("agrees on how many wei make a stroop", () => {
    // 18 decimals on Ethereum, 7 on Stellar: one stroop is 10^11 wei.
    expect(MIN_WEI_PER_STROOP).toBe(10n ** 11n);
    expect(ETHEREUM_DECIMALS - STELLAR_DECIMALS).toBe(11);
  });

  it("parses the same decimal string to each chain's atomic units", () => {
    expect(value(parseDecimalToAtomic("1", ETHEREUM_DECIMALS))).toBe(10n ** 18n);
    expect(value(parseDecimalToAtomic("1", STELLAR_DECIMALS))).toBe(10_000_000n);
    expect(value(parseDecimalToAtomic("1.5", ETHEREUM_DECIMALS))).toBe(1_500_000_000_000_000_000n);
    expect(value(parseDecimalToAtomic("1.5", STELLAR_DECIMALS))).toBe(15_000_000n);
  });

  it("never routes an amount through a double", () => {
    // 0.1 ETH in wei exceeds what a double can hold exactly; parsing must not
    // lose the low digits.
    expect(value(parseDecimalToAtomic("0.1", ETHEREUM_DECIMALS))).toBe(100_000_000_000_000_000n);
    expect(value(parseDecimalToAtomic("1234.000000000000000001", ETHEREUM_DECIMALS))).toBe(
      1_234_000_000_000_000_000_001n,
    );
  });

  it("treats trailing zeros as exact, not as excess precision", () => {
    expect(value(parseDecimalToAtomic("1.50", STELLAR_DECIMALS))).toBe(15_000_000n);
    expect(value(parseDecimalToAtomic("1.500000000", STELLAR_DECIMALS))).toBe(15_000_000n);
  });
});

describe("boundary values", () => {
  it("carries the smallest representable amount both ways", () => {
    // One stroop is the smallest value the bridge can move.
    expect(value(stroopsToWei(MIN_STELLAR_STROOPS))).toBe(MIN_WEI_PER_STROOP);
    expect(value(weiToStroops(MIN_WEI_PER_STROOP))).toBe(MIN_STELLAR_STROOPS);
  });

  it("refuses anything below the smallest representable amount", () => {
    // One wei short of a stroop, and a single wei: neither exists on Stellar.
    expect(weiToStroops(MIN_WEI_PER_STROOP - 1n)).toEqual({ ok: false, code: "precision_loss" });
    expect(weiToStroops(1n)).toEqual({ ok: false, code: "precision_loss" });
  });

  it("carries the largest representable amount", () => {
    const maxWei = value(stroopsToWei(MAX_STELLAR_STROOPS));
    expect(value(weiToStroops(maxWei))).toBe(MAX_STELLAR_STROOPS);
    expect(maxWei).toBe(MAX_STELLAR_STROOPS * MIN_WEI_PER_STROOP);
  });

  it("refuses an amount past Stellar's ceiling", () => {
    const overCeiling = (MAX_STELLAR_STROOPS + 1n) * MIN_WEI_PER_STROOP;
    expect(weiToStroops(overCeiling)).toEqual({ ok: false, code: "overflow" });
    expect(stroopsToWei(MAX_STELLAR_STROOPS + 1n)).toEqual({ ok: false, code: "overflow" });
  });

  it("carries zero unchanged", () => {
    expect(value(weiToStroops(0n))).toBe(0n);
    expect(value(stroopsToWei(0n))).toBe(0n);
  });

  it("refuses negative amounts", () => {
    expect(weiToStroops(-1n * MIN_WEI_PER_STROOP)).toEqual({ ok: false, code: "negative" });
    expect(parseDecimalToAtomic("-1", STELLAR_DECIMALS)).toEqual({ ok: false, code: "negative" });
  });
});

describe("fractional boundaries", () => {
  it("accepts exactly seven decimals and refuses an eighth", () => {
    expect(value(parseDecimalToAtomic("0.0000001", STELLAR_DECIMALS))).toBe(1n);
    expect(parseDecimalToAtomic("0.00000001", STELLAR_DECIMALS)).toEqual({
      ok: false,
      code: "precision_loss",
    });
  });

  it("bridges a wei amount only when it lands on a stroop", () => {
    // 0.1 ETH is 10^17 wei, a whole number of stroops. One wei more is not.
    expect(isBridgeableWei(100_000_000_000_000_000n)).toBe(true);
    expect(isBridgeableWei(100_000_000_000_000_001n)).toBe(false);
  });

  it("walks the boundary one wei at a time", () => {
    const onStroop = 5n * MIN_WEI_PER_STROOP;
    expect(isBridgeableWei(onStroop)).toBe(true);

    for (let offset = 1n; offset < 5n; offset += 1n) {
      expect(isBridgeableWei(onStroop + offset)).toBe(false);
      expect(isBridgeableWei(onStroop - offset)).toBe(false);
    }
  });

  it("refuses the fractional dust an eighteen-decimal quote can carry", () => {
    // A quote priced in wei will routinely land off a stroop; the bridge must
    // say so rather than keep the difference.
    const dusty = value(parseDecimalToAtomic("1.000000000000000001", ETHEREUM_DECIMALS));
    expect(weiToStroops(dusty)).toEqual({ ok: false, code: "precision_loss" });
  });
});

describe("value is preserved across a round trip", () => {
  const bridgeable = [
    "0.0000001",
    "0.0000010",
    "1.0000000",
    "1.5000000",
    "1234.5678901",
    "999999999.9999999",
  ];

  it("returns the same amount after crossing and coming back", () => {
    for (const amount of bridgeable) {
      const stroops = value(parseDecimalToAtomic(amount, STELLAR_DECIMALS));
      const wei = value(stroopsToWei(stroops));
      expect(value(weiToStroops(wei))).toBe(stroops);
      expect(formatAtomicToDecimal(stroops, STELLAR_DECIMALS)).toBe(amount);
    }
  });

  it("refuses an eight-decimal amount that a wei quote can express", () => {
    // 1.23456789 exists in wei but not in stroops, so it cannot cross.
    expect(parseDecimalToAtomic("1.23456789", STELLAR_DECIMALS)).toEqual({
      ok: false,
      code: "precision_loss",
    });
    expect(value(parseDecimalToAtomic("1.23456789", ETHEREUM_DECIMALS))).toBe(
      1_234_567_890_000_000_000n,
    );
  });

  it("keeps Ethereum and Stellar renderings of one amount in agreement", () => {
    const stroops = value(parseDecimalToAtomic("2.5000000", STELLAR_DECIMALS));
    const wei = value(stroopsToWei(stroops));

    expect(formatAtomicToDecimal(stroops, STELLAR_DECIMALS)).toBe("2.5000000");
    expect(formatAtomicToDecimal(wei, ETHEREUM_DECIMALS)).toBe("2.500000000000000000");
  });
});

describe("convertAtomic", () => {
  it("scales up exactly in every direction", () => {
    expect(value(convertAtomic({ amount: 1n, fromDecimals: 7, toDecimals: 18 }))).toBe(10n ** 11n);
    expect(value(convertAtomic({ amount: 1n, fromDecimals: 6, toDecimals: 18 }))).toBe(10n ** 12n);
    expect(value(convertAtomic({ amount: 5n, fromDecimals: 7, toDecimals: 7 }))).toBe(5n);
  });

  it("scales down only when nothing is lost", () => {
    expect(value(convertAtomic({ amount: 10n ** 11n, fromDecimals: 18, toDecimals: 7 }))).toBe(1n);
    expect(convertAtomic({ amount: 10n ** 11n - 1n, fromDecimals: 18, toDecimals: 7 })).toEqual({
      ok: false,
      code: "precision_loss",
    });
  });

  it("handles a six-decimal token such as USDC", () => {
    // USDC is coarser than Stellar, so every USDC amount crosses exactly.
    const usdc = value(parseDecimalToAtomic("1.234567", 6));
    expect(value(convertAtomic({ amount: usdc, fromDecimals: 6, toDecimals: STELLAR_DECIMALS }))).toBe(
      12_345_670n,
    );
  });
});

describe("formatAtomicToDecimal", () => {
  it("always renders the full precision", () => {
    expect(formatAtomicToDecimal(0n, STELLAR_DECIMALS)).toBe("0.0000000");
    expect(formatAtomicToDecimal(1n, STELLAR_DECIMALS)).toBe("0.0000001");
    expect(formatAtomicToDecimal(10n ** 18n, ETHEREUM_DECIMALS)).toBe("1.000000000000000000");
  });

  it("round-trips through parsing", () => {
    for (const atomic of [0n, 1n, 10_000_000n, MAX_STELLAR_STROOPS]) {
      const rendered = formatAtomicToDecimal(atomic, STELLAR_DECIMALS);
      expect(value(parseDecimalToAtomic(rendered, STELLAR_DECIMALS))).toBe(atomic);
    }
  });
});

describe("rejects malformed input", () => {
  it("refuses anything that is not a plain decimal", () => {
    for (const input of ["", "abc", ".5", "1,5", "1e18", "0x10", " "]) {
      expect(parseDecimalToAtomic(input, STELLAR_DECIMALS)).toEqual({
        ok: false,
        code: "not_a_decimal",
      });
    }
  });
});
