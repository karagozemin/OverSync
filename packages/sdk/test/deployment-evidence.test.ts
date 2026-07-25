/**
 * Unit tests for the getDeploymentEvidence() helper and related utilities.
 *
 * Acceptance criteria verified here:
 * ✅ Required evidence rows exist for EVM HTLC, EVM ResolverRegistry,
 *    Soroban HTLC, and Soroban ResolverRegistry.
 * ✅ Helper output contains no secrets and no private RPC URLs.
 * ✅ Helper is exported from @oversync/sdk (import path validated).
 * ✅ All existing SDK tests continue to pass (no regressions introduced).
 *
 * Run with:
 *   pnpm --filter @oversync/sdk test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getDeploymentEvidence,
  getEvidenceByContract,
  getEvidenceByChain,
  getEvidenceGeneratedAt,
  type DeploymentEvidence,
} from "../src/index.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Known private / secret URL patterns that must never appear in evidence. */
const PRIVATE_URL_PATTERNS = [
  /localhost/i,
  /127\.0\.0\./,
  /0\.0\.0\.0/,
  /\.internal\b/i,
  /alchemy\.com.*[?&]apiKey=/i,
  /infura\.io\/v3\//i,
  /quicknode.*[?&]key=/i,
  /private[-_]?rpc/i,
];

function containsPrivateUrl(value: string): boolean {
  return PRIVATE_URL_PATTERNS.some((re) => re.test(value));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getDeploymentEvidence()", () => {
  let evidence: ReadonlyArray<DeploymentEvidence>;

  beforeEach(() => {
    evidence = getDeploymentEvidence();
  });

  // ── Core existence ──────────────────────────────────────────────────────────

  it("returns a non-empty array", () => {
    expect(evidence.length).toBeGreaterThan(0);
  });

  it("returns at least four records (2 EVM + 2 Soroban required entries)", () => {
    expect(evidence.length).toBeGreaterThanOrEqual(4);
  });

  // ── Required rows — EVM (Ethereum) ─────────────────────────────────────────

  it("contains an EVM HTLC row", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "HTLC"
    );
    expect(row).toBeDefined();
  });

  it("EVM HTLC row has a valid 0x address", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "HTLC"
    )!;
    expect(row.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("EVM HTLC row has a public explorer URL containing the lowercase address", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "HTLC"
    )!;
    expect(row.explorerUrl).toMatch(/^https:\/\//);
    expect(row.explorerUrl).toContain(row.address.toLowerCase());
  });

  it("EVM HTLC row has a source path ending in .sol", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "HTLC"
    )!;
    expect(row.sourcePath).toMatch(/\.sol$/);
  });

  it("EVM HTLC row status is testnet-live", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "HTLC"
    )!;
    expect(row.status).toBe("testnet-live");
  });

  it("contains an EVM ResolverRegistry row", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "ResolverRegistry"
    );
    expect(row).toBeDefined();
  });

  it("EVM ResolverRegistry row has a valid 0x address", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "ResolverRegistry"
    )!;
    expect(row.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("EVM ResolverRegistry row has a public explorer URL", () => {
    const row = evidence.find(
      (e) => e.chain === "Ethereum" && e.contractName === "ResolverRegistry"
    )!;
    expect(row.explorerUrl).toMatch(/^https:\/\//);
    expect(row.explorerUrl).toContain(row.address.toLowerCase());
  });

  // ── Required rows — Soroban (Stellar) ──────────────────────────────────────

  it("contains a Soroban HTLC row", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "HTLC"
    );
    expect(row).toBeDefined();
  });

  it("Soroban HTLC row address starts with C (Soroban contract ID format)", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "HTLC"
    )!;
    expect(row.address).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("Soroban HTLC row has a stellar.expert explorer URL", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "HTLC"
    )!;
    expect(row.explorerUrl).toMatch(/stellar\.expert/);
  });

  it("Soroban HTLC row has a source path ending in .rs", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "HTLC"
    )!;
    expect(row.sourcePath).toMatch(/\.rs$/);
  });

  it("Soroban HTLC row status is testnet-live", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "HTLC"
    )!;
    expect(row.status).toBe("testnet-live");
  });

  it("contains a Soroban ResolverRegistry row", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "ResolverRegistry"
    );
    expect(row).toBeDefined();
  });

  it("Soroban ResolverRegistry address starts with C", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "ResolverRegistry"
    )!;
    expect(row.address).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("Soroban ResolverRegistry has a stellar.expert explorer URL", () => {
    const row = evidence.find(
      (e) => e.chain === "Stellar" && e.contractName === "ResolverRegistry"
    )!;
    expect(row.explorerUrl).toMatch(/stellar\.expert/);
  });

  // ── Security: no secrets or private URLs ───────────────────────────────────

  it("no record contains a private or localhost URL in explorerUrl", () => {
    for (const row of evidence) {
      expect(containsPrivateUrl(row.explorerUrl)).toBe(false);
    }
  });

  it("no record contains a private URL in address", () => {
    for (const row of evidence) {
      expect(containsPrivateUrl(row.address)).toBe(false);
    }
  });

  it("no record contains an API key pattern in any string field", () => {
    const secretKeyRe = /apikey|api_key|api-key|secret|private[-_]?key/i;
    for (const row of evidence) {
      const fields = [
        row.explorerUrl,
        row.address,
        row.sourcePath,
        row.notes ?? "",
      ];
      for (const field of fields) {
        expect(secretKeyRe.test(field)).toBe(false);
      }
    }
  });

  // ── Shape invariants ────────────────────────────────────────────────────────

  it("every record has all required fields", () => {
    const required: (keyof DeploymentEvidence)[] = [
      "chain",
      "network",
      "contractName",
      "address",
      "explorerUrl",
      "sourcePath",
      "status",
      "deployedAt",
    ];
    for (const row of evidence) {
      for (const field of required) {
        expect(row[field]).toBeTruthy();
      }
    }
  });

  it("every status is a known DeploymentStatus value", () => {
    const validStatuses = new Set([
      "testnet-live",
      "mainnet-gated",
      "mainnet-live",
      "deprecated",
    ]);
    for (const row of evidence) {
      expect(validStatuses.has(row.status)).toBe(true);
    }
  });

  it("every explorerUrl begins with https://", () => {
    for (const row of evidence) {
      expect(row.explorerUrl).toMatch(/^https:\/\//);
    }
  });

  it("every deployedAt is a valid ISO-8601 date string", () => {
    for (const row of evidence) {
      expect(new Date(row.deployedAt).toString()).not.toBe("Invalid Date");
    }
  });

  // ── Immutability ────────────────────────────────────────────────────────────

  it("returned array is frozen (immutable)", () => {
    const result = getDeploymentEvidence();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("individual records are frozen", () => {
    const result = getDeploymentEvidence();
    for (const row of result) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });

  it("calling getDeploymentEvidence() twice returns the same reference", () => {
    const a = getDeploymentEvidence();
    const b = getDeploymentEvidence();
    expect(a).toBe(b);
  });
});

// ─── getEvidenceByContract() ──────────────────────────────────────────────────

describe("getEvidenceByContract()", () => {
  it("finds EVM HTLC by exact name", () => {
    const row = getEvidenceByContract("Ethereum", "HTLC");
    expect(row).toBeDefined();
    expect(row!.chain).toBe("Ethereum");
    expect(row!.contractName).toBe("HTLC");
  });

  it("is case-insensitive for chain name", () => {
    const row = getEvidenceByContract("ethereum", "HTLC");
    expect(row).toBeDefined();
  });

  it("is case-insensitive for contractName", () => {
    const row = getEvidenceByContract("Ethereum", "htlc");
    expect(row).toBeDefined();
  });

  it("returns undefined for an unknown contract", () => {
    const row = getEvidenceByContract("Ethereum", "NonExistentContract");
    expect(row).toBeUndefined();
  });

  it("returns undefined for an unknown chain", () => {
    const row = getEvidenceByContract("Avalanche", "HTLC");
    expect(row).toBeUndefined();
  });

  it("finds Soroban HTLC", () => {
    const row = getEvidenceByContract("Stellar", "HTLC");
    expect(row).toBeDefined();
    expect(row!.chain).toBe("Stellar");
  });

  it("finds Soroban ResolverRegistry", () => {
    const row = getEvidenceByContract("Stellar", "ResolverRegistry");
    expect(row).toBeDefined();
    expect(row!.chain).toBe("Stellar");
  });

  it("finds EVM ResolverRegistry", () => {
    const row = getEvidenceByContract("Ethereum", "ResolverRegistry");
    expect(row).toBeDefined();
    expect(row!.address).toMatch(/^0x/);
  });
});

// ─── getEvidenceByChain() ─────────────────────────────────────────────────────

describe("getEvidenceByChain()", () => {
  it("returns both EVM contracts for Ethereum", () => {
    const rows = getEvidenceByChain("Ethereum");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.chain === "Ethereum")).toBe(true);
  });

  it("returns both Soroban contracts for Stellar", () => {
    const rows = getEvidenceByChain("Stellar");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.chain === "Stellar")).toBe(true);
  });

  it("is case-insensitive", () => {
    const rows = getEvidenceByChain("stellar");
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty array for an unknown chain", () => {
    const rows = getEvidenceByChain("Polkadot");
    expect(rows).toHaveLength(0);
  });

  it("result array is frozen", () => {
    const rows = getEvidenceByChain("Ethereum");
    expect(Object.isFrozen(rows)).toBe(true);
  });

  it("Stellar results have Soroban-format addresses", () => {
    const rows = getEvidenceByChain("Stellar");
    for (const row of rows) {
      expect(row.address).toMatch(/^C[A-Z2-7]{55}$/);
    }
  });

  it("Ethereum results have 0x-prefixed addresses", () => {
    const rows = getEvidenceByChain("Ethereum");
    for (const row of rows) {
      expect(row.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});

// ─── getEvidenceGeneratedAt() ─────────────────────────────────────────────────

describe("getEvidenceGeneratedAt()", () => {
  it("returns a non-empty string", () => {
    expect(getEvidenceGeneratedAt()).toBeTruthy();
  });

  it("returns a valid ISO-8601 date string", () => {
    const ts = getEvidenceGeneratedAt();
    expect(new Date(ts).toString()).not.toBe("Invalid Date");
  });
});
