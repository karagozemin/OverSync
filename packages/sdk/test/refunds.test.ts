import { describe, it, expect } from "vitest";
import { checkRefundEligibility } from "../src/utils/refunds.js";
import type { Order } from "../src/types/index.js";

const CURRENT_TIME = 1000000;

function createMockOrder(overrides: Partial<Order> = {}): Order {
  return {
    publicId: "order-123",
    direction: "eth_to_xlm",
    status: "src_locked",
    hashlock: "0xabc123",
    preimage: null,
    src: {
      chain: "ethereum",
      address: "0xeth",
      asset: "0x0000000000000000000000000000000000000000",
      amount: "1000000000000000000",
      timelock: CURRENT_TIME + 3600, // Not expired by default
    },
    dst: {
      chain: "stellar",
      address: "GABC",
      asset: "native",
      amount: "5000000000",
      timelock: null,
    },
    ...overrides,
  };
}

describe("checkRefundEligibility", () => {
  it("returns UNKNOWN_ORDER for null or undefined", () => {
    expect(checkRefundEligibility(null, CURRENT_TIME)).toEqual({ isEligible: false, reason: "UNKNOWN_ORDER" });
    expect(checkRefundEligibility(undefined, CURRENT_TIME)).toEqual({ isEligible: false, reason: "UNKNOWN_ORDER" });
  });

  it("returns UNKNOWN_ORDER if src.timelock is missing", () => {
    const order = createMockOrder();
    order.src.timelock = null;
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "UNKNOWN_ORDER" });
  });

  it("returns ALREADY_REFUNDED if status is refunded", () => {
    const order = createMockOrder({ status: "refunded" });
    // Even if it's past the timelock
    order.src.timelock = CURRENT_TIME - 1000;
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "ALREADY_REFUNDED" });
  });

  it("returns ALREADY_CLAIMED if status is completed", () => {
    const order = createMockOrder({ status: "completed" });
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "ALREADY_CLAIMED" });
  });

  it("returns ALREADY_CLAIMED if status is secret_revealed", () => {
    const order = createMockOrder({ status: "secret_revealed" });
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "ALREADY_CLAIMED" });
  });

  it("returns NOT_EXPIRED if current time is before timelock", () => {
    const order = createMockOrder(); // default timelock is CURRENT_TIME + 3600
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "NOT_EXPIRED" });
  });

  it("returns ELIGIBLE if current time is at or past timelock", () => {
    const order = createMockOrder();
    order.src.timelock = CURRENT_TIME - 100;
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: true, reason: "ELIGIBLE" });
  });

  it("works correctly for XLM->ETH direction", () => {
    const order = createMockOrder({
      direction: "xlm_to_eth",
      src: {
        chain: "stellar",
        address: "GABC",
        asset: "native",
        amount: "5000000000",
        timelock: CURRENT_TIME - 500, // Expired
      },
      dst: {
        chain: "ethereum",
        address: "0xeth",
        asset: "0x0000000000000000000000000000000000000000",
        amount: "1000000000000000000",
      }
    });
    
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: true, reason: "ELIGIBLE" });
    
    // Change to not expired
    order.src.timelock = CURRENT_TIME + 500;
    expect(checkRefundEligibility(order, CURRENT_TIME)).toEqual({ isEligible: false, reason: "NOT_EXPIRED" });
  });
});
