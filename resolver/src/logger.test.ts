import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { redactLog, getLogger } from "./logger.js";
import pino from "pino";

describe("OverSync Resolver Log Redaction Framework Regression Tests", () => {

  describe("Core redactLog Pure Utility Matching Validation", () => {
    it("should securely filter out 64-character raw hex private keys", () => {
      const targetRawKey = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b";
      const cleanLog = `Initializing signature contexts utilizing key: 0x${targetRawKey}`;
      const result = redactLog(cleanLog);

      expect(result).not.toContain(targetRawKey);
      expect(result).toContain("[REDACTED_KEY]");
    });

    it("should strip out embedded authentication parameters from basic-auth RPC endpoints", () => {
      const endpointLog = "Connecting to upstream fallback cluster interface at https://admin-user:superSecretPassword123@eth-mainnet.alchemyapi.io/v2/token";
      const result = redactLog(endpointLog);

      expect(result).not.toContain("admin-user");
      expect(result).not.toContain("superSecretPassword123");
      expect(result).toContain("[REDACTED]:[REDACTED]@eth-mainnet.alchemyapi.io");
    });

    it("should sanitize multi-word BIP-39 mnemonic phrase configurations", () => {
      const rawMnemonic = "apple banana cherry dog elephant fox grape horse isolated jacket kite lemon";
      const contextString = `Resolver core mnemonic recovery block sequence: ${rawMnemonic}`;
      const result = redactLog(contextString);

      expect(result).not.toContain("apple banana");
      expect(result).toContain("[REDACTED_MNEMONIC]");
    });

    it("should catch explicit Bearer token authorizations and structural HTLC secrets safely", () => {
      const bearerPayload = "Authorization header payload emitted: Bearer ghp_ABC123secretTokenValueStringHere";
      const htlcPayload = "Settling cross-chain swap request where preimage='0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c'";

      expect(redactLog(bearerPayload)).toContain("Bearer [REDACTED]");
      expect(redactLog(htlcPayload)).not.toContain("0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c");
    });

    it("should preserve standard configurations like port layout configurations and safe paths", () => {
      const safeOutput = "Resolver active on interface port=8080 routing path=/api/v1/health with workerId=01";
      expect(redactLog(safeOutput)).toBe(safeOutput);
    });
  });

  describe("Pino Stream Integration System Verification", () => {
    let writeSpy: any;

    beforeEach(() => {
      // Intercept standard streams to capture formatting payload evaluations
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should sanitize nested objects passed directly to pino log methods", () => {
      // Force development mode profile configuration targeting stream writing loops
      const logger = getLogger("info");

      logger.info({
        msg: "Runtime debugging profile",
        secretData: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
        nested: {
          token: "Bearer secret-token-abc"
        }
      });

      expect(writeSpy).toHaveBeenCalled();
      const rawLoggedOutput = writeSpy.mock.calls[0][0] as string;

      expect(rawLoggedOutput).not.toContain("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b");
      expect(rawLoggedOutput).not.toContain("secret-token-abc");
      expect(rawLoggedOutput).toContain("[REDACTED_KEY]");
      expect(rawLoggedOutput).toContain("[REDACTED]");
    });
  });
});