import { describe, it, expect } from "vitest";
import { validateTimelockOrdering } from "../src/utils/timelock-validator.js";

describe("validateTimelockOrdering", () => {
  const minGap = 600;

  it("returns isValid: true for a valid ordering", () => {
    const srcTimelock = 10000;
    const dstTimelock = 9000; // Gap is 1000, > 600
    const result = validateTimelockOrdering(srcTimelock, dstTimelock, minGap);
    expect(result.isValid).toBe(true);
  });

  it("returns isValid: true when gap is exactly minGap", () => {
    const srcTimelock = 10000;
    const dstTimelock = 9400; // Gap is 600, == 600
    const result = validateTimelockOrdering(srcTimelock, dstTimelock, minGap);
    expect(result.isValid).toBe(true);
  });

  it("returns error TIMELOCKS_REVERSED when dstTimelock > srcTimelock", () => {
    const srcTimelock = 10000;
    const dstTimelock = 11000;
    const result = validateTimelockOrdering(srcTimelock, dstTimelock, minGap);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("TIMELOCKS_REVERSED");
  });

  it("returns error TIMELOCKS_REVERSED when dstTimelock == srcTimelock", () => {
    const srcTimelock = 10000;
    const dstTimelock = 10000;
    const result = validateTimelockOrdering(srcTimelock, dstTimelock, minGap);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("TIMELOCKS_REVERSED");
  });

  it("returns error GAP_TOO_SMALL when gap is less than minGap", () => {
    const srcTimelock = 10000;
    const dstTimelock = 9500; // Gap is 500, < 600
    const result = validateTimelockOrdering(srcTimelock, dstTimelock, minGap);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("GAP_TOO_SMALL");
  });
});
