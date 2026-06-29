import { describe, it, expect } from "vitest";
import { generateSecret, hashSecret, verifyPreimage, assertValidSecretFormat } from "../src/secrets/index.js";

describe("secrets", () => {
  it("generates a 32-byte secret with both digests", () => {
    const s = generateSecret();
    expect(s.preimage).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s.keccak256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s.sha256).not.toBe(s.keccak256);
  });

  it("hashSecret is deterministic", () => {
    const s = generateSecret();
    const s2 = hashSecret(s.preimage);
    expect(s2.sha256).toBe(s.sha256);
    expect(s2.keccak256).toBe(s.keccak256);
  });

  it("verifyPreimage detects both sha256 and keccak256 commitments", () => {
    const s = generateSecret();
    expect(verifyPreimage(s.preimage, s.sha256)).toBe("sha256");
    expect(verifyPreimage(s.preimage, s.keccak256)).toBe("keccak256");
    const other = generateSecret();
    expect(verifyPreimage(s.preimage, other.sha256)).toBeNull();
  });

  describe("assertValidSecretFormat", () => {
    it("accepts valid 32-byte hex strings with 0x prefix", () => {
      const valid = "0x" + "a".repeat(64);
      expect(assertValidSecretFormat(valid)).toBe(valid);
    });

    it("accepts valid uppercase hex characters", () => {
      const validUpper = "0x" + "A".repeat(64);
      expect(assertValidSecretFormat(validUpper)).toBe(validUpper);
    });

    it("rejects non-strings", () => {
      expect(() => assertValidSecretFormat(123)).toThrow("secret must be a string");
      expect(() => assertValidSecretFormat(null)).toThrow("secret must be a string");
    });

    it("rejects strings without 0x prefix", () => {
      expect(() => assertValidSecretFormat("a".repeat(64))).toThrow('secret must start with "0x"');
    });

    it("rejects wrong length strings", () => {
      expect(() => assertValidSecretFormat("0x" + "a".repeat(62))).toThrow("secret must be exactly 32 bytes (64 hex characters)");
      expect(() => assertValidSecretFormat("0x" + "a".repeat(66))).toThrow("secret must be exactly 32 bytes (64 hex characters)");
    });

    it("rejects strings with non-hex characters", () => {
      const invalid = "0x" + "g".repeat(64); // 'g' is not valid hex
      expect(() => assertValidSecretFormat(invalid)).toThrow("secret contains invalid hex characters");
    });

    it("uses custom field name in errors", () => {
      expect(() => assertValidSecretFormat("invalid", "hashlock")).toThrow('hashlock must start with "0x"');
    });
  });
});
