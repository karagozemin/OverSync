import { describe, it, expect } from "vitest";
import {
  computeRefundEligibility,
  type RefundEligibilityInput,
} from "../src/state-machine/refund-eligibility.js";

const NOW = 1_700_000_000;

describe("computeRefundEligibility", () => {
  describe("Unknown Order", () => {
    it("returns unknown_order when input is missing or empty", () => {
      const res1 = computeRefundEligibility();
      expect(res1).toEqual({
        eligible: false,
        reasonCode: "unknown_order",
        reason: "unknown order",
        timeRemainingSeconds: 0,
      });

      const res2 = computeRefundEligibility({ status: null });
      expect(res2.reasonCode).toBe("unknown_order");

      const res3 = computeRefundEligibility({ status: "unknown" });
      expect(res3.reasonCode).toBe("unknown_order");
    });
  });

  describe("Already Refunded", () => {
    it("returns already_refunded for refunded orders regardless of timelock or direction", () => {
      const resEth = computeRefundEligibility({
        direction: "eth_to_xlm",
        status: "refunded",
        timelock: NOW - 100,
        nowUnixSeconds: NOW,
      });
      expect(resEth).toEqual({
        eligible: false,
        reasonCode: "already_refunded",
        reason: "already refunded",
        timeRemainingSeconds: 0,
      });

      const resXlm = computeRefundEligibility({
        direction: "xlm_to_eth",
        status: "refunded",
        timelock: NOW - 100,
        nowUnixSeconds: NOW,
      });
      expect(resXlm).toEqual({
        eligible: false,
        reasonCode: "already_refunded",
        reason: "already refunded",
        timeRemainingSeconds: 0,
      });
    });
  });

  describe("Already Claimed", () => {
    it("returns already_claimed when status is completed", () => {
      const res = computeRefundEligibility({
        direction: "eth_to_xlm",
        status: "completed",
        timelock: NOW - 500,
        nowUnixSeconds: NOW,
      });
      expect(res).toEqual({
        eligible: false,
        reasonCode: "already_claimed",
        reason: "already claimed",
        timeRemainingSeconds: 0,
      });
    });

    it("returns already_claimed when status is secret_revealed", () => {
      const res = computeRefundEligibility({
        direction: "xlm_to_eth",
        status: "secret_revealed",
        timelock: NOW - 500,
        nowUnixSeconds: NOW,
      });
      expect(res).toEqual({
        eligible: false,
        reasonCode: "already_claimed",
        reason: "already claimed",
        timeRemainingSeconds: 0,
      });
    });
  });

  describe("ETH -> XLM Swap Refund Eligibility", () => {
    it("returns not_expired when timelock is in the future for src_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "src_locked",
        timelock: NOW + 3600,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(false);
      expect(res.reasonCode).toBe("not_expired");
      expect(res.reason).toBe("not expired");
      expect(res.timeRemainingSeconds).toBe(3600);
    });

    it("returns not_expired when timelock is missing/zero for announced", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "announced",
        timelock: 0,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(false);
      expect(res.reasonCode).toBe("not_expired");
      expect(res.timeRemainingSeconds).toBe(0);
    });

    it("returns eligible when timelock has passed for src_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "src_locked",
        timelock: NOW - 100,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
      expect(res.reason).toBe("eligible");
      expect(res.timeRemainingSeconds).toBe(0);
    });

    it("returns eligible when timelock has passed for dst_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "dst_locked",
        timelock: NOW - 1,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });

    it("returns eligible when timelock has passed for failed status", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "failed",
        timelock: NOW - 10,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });

    it("returns eligible when timelock has passed for expired status", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "expired",
        timelock: NOW - 10,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });

    it("returns eligible when nowUnixSeconds is exactly equal to timelock", () => {
      const input: RefundEligibilityInput = {
        direction: "eth_to_xlm",
        status: "src_locked",
        timelock: NOW,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });
  });

  describe("XLM -> ETH Swap Refund Eligibility", () => {
    it("returns not_expired when timelock is in the future for src_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "xlm_to_eth",
        status: "src_locked",
        timelock: NOW + 1200,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(false);
      expect(res.reasonCode).toBe("not_expired");
      expect(res.timeRemainingSeconds).toBe(1200);
    });

    it("returns eligible when timelock has passed for src_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "xlm_to_eth",
        status: "src_locked",
        timelock: NOW - 500,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
      expect(res.reason).toBe("eligible");
      expect(res.timeRemainingSeconds).toBe(0);
    });

    it("returns eligible when timelock has passed for dst_locked", () => {
      const input: RefundEligibilityInput = {
        direction: "xlm_to_eth",
        status: "dst_locked",
        timelock: NOW - 50,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });

    it("returns eligible when timelock has passed for failed status", () => {
      const input: RefundEligibilityInput = {
        direction: "xlm_to_eth",
        status: "failed",
        timelock: NOW - 100,
        nowUnixSeconds: NOW,
      };
      const res = computeRefundEligibility(input);
      expect(res.eligible).toBe(true);
      expect(res.reasonCode).toBe("eligible");
    });
  });
});
