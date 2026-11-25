/**
 * Tests for resolver/src/commands/register.ts
 *
 * All registry reads are stubbed so that no real RPC calls are made.
 * Covers every acceptance criterion from issue #269:
 *
 *  ✓  Address mismatch → sends nothing, throws
 *  ✓  Already registered on both sides → sends nothing
 *  ✓  One side missing → one transaction submitted
 *  ✓  Dry-run → sends nothing
 *  ✓  Happy-path → both sides registered
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------
// Hoisted mocks — referenced inside vi.mock() factory so they must
// be defined with vi.hoisted() before vi.mock() is called.
// ---------------------------------------------------------------
const {
  mockReadContract,
  mockWriteContract,
  mockWaitForTransactionReceipt,
  mockSimulateTransaction,
  mockSendTransaction,
  mockGetTransaction,
  mockGetAccount,
  mockContractCall,
  mockAssembleTransaction
} = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  mockWriteContract: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
  mockSimulateTransaction: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockGetTransaction: vi.fn(),
  mockGetAccount: vi.fn(),
  mockContractCall: vi.fn(),
  mockAssembleTransaction: vi.fn()
}));

vi.mock("../src/network-agreement.js", () => ({
  checkResolverNetworkAgreement: async () => ({ status: "ok", detail: "networks agree" })
}));

// ---------------------------------------------------------------
// Mock: config
// ---------------------------------------------------------------
vi.mock("../src/config.js", () => {
  let mockCfg: any = {};
  return {
    loadConfig: () => mockCfg,
    __setMockConfig: (cfg: any) => {
      mockCfg = cfg;
    }
  };
});

// ---------------------------------------------------------------
// Mock: viem
// ---------------------------------------------------------------
vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mockReadContract,
      waitForTransactionReceipt: mockWaitForTransactionReceipt
    }),
    createWalletClient: () => ({
      writeContract: mockWriteContract
    })
  };
});

// ---------------------------------------------------------------
// Mock: viem/accounts
// ---------------------------------------------------------------
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: () => ({
    address: "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01"
  })
}));

// ---------------------------------------------------------------
// Mock: @stellar/stellar-sdk
// ---------------------------------------------------------------
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction
      })),
      Api: {
        isSimulationError: (sim: any) => Boolean((sim as any).error),
        isSimulationSuccess: (sim: any) => Boolean((sim as any).result)
      },
      assembleTransaction: mockAssembleTransaction
    },
    Keypair: {
      fromSecret: () => ({
        publicKey: () => "GABC123PUBLICKEY"
      })
    },
    Contract: vi.fn().mockImplementation(() => ({
      call: mockContractCall.mockReturnValue({ type: "operation" })
    })),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ sign: vi.fn() })
    })),
    nativeToScVal: vi.fn().mockReturnValue({})
  };
});

// ---------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------
import { registerCommand } from "../src/commands/register.js";
import { __setMockConfig } from "../src/config.js";
import { rpc as rpcMock, Contract as ContractMock, TransactionBuilder as TransactionBuilderMock } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------
// Constants
// ---------------------------------------------------------------
const ADDR_REGISTRY    = "0x2222222222222222222222222222222222222222";
const ADDR_ESCROW      = "0x1111111111111111111111111111111111111111";
const ADDR_STAKE_ASSET = "0x3333333333333333333333333333333333333333";
const ADDR_WRONG       = "0x9999999999999999999999999999999999999999";

const BASE_CONFIG = {
  logLevel: "silent",
  network: "testnet",
  pollIntervalMs: 15_000,
  coordinatorUrl: "http://localhost:3001",
  ethereum: {
    rpcUrl: "http://localhost:8545",
    chainId: 11_155_111,
    htlcEscrow: ADDR_ESCROW,
    resolverRegistry: ADDR_REGISTRY,
    resolverPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  soroban: {
    rpcUrl: "http://localhost:8000",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "http://localhost:8001",
    htlc: "CSOROBANHTLCADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    resolverRegistry: "CSOROBANREGISTRYADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    resolverSecret: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBB6"
  }
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/** Build a Soroban retval stub that returns a boolean. */
function sorobanBoolRetval(value: boolean) {
  return {
    result: {
      retval: {
        switch: () => ({ name: "scvBool" }),
        b: () => value
      }
    }
  };
}

/**
 * After vi.resetAllMocks() all mock class implementations are cleared.
 * Re-wire every Stellar SDK class so subsequent tests get working objects.
 */
function restoreStellarServerMock() {
  (rpcMock.Server as any).mockImplementation(() => ({
    getAccount: mockGetAccount,
    simulateTransaction: mockSimulateTransaction,
    sendTransaction: mockSendTransaction,
    getTransaction: mockGetTransaction
  }));
  mockAssembleTransaction.mockReturnValue({
    build: vi.fn().mockReturnValue({ sign: vi.fn() })
  });
  // Restore Contract constructor
  (ContractMock as any).mockImplementation(() => ({
    call: mockContractCall
  }));
  mockContractCall.mockReturnValue({ type: "operation" });
  // Restore TransactionBuilder constructor
  (TransactionBuilderMock as any).mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ sign: vi.fn() })
  }));
}

/**
 * Set up readContract mock sequence for validateEvmRegistry + (optionally) registerEvm.
 *
 * Call order when htlcEscrow is set:
 *   1. escrow.resolverRegistry()   → escrowPtr
 *   2. registry.isActive()         → alreadyActive
 * if !alreadyActive:
 *   3. registry.stakeAsset()       → stakeAsset
 *   4/5/6. decimals / symbol / minStake  (Promise.all, same order as implementation)
 */
function setupEvmMocks(opts: {
  escrowPtr?: string;
  alreadyActive: boolean;
  stakeAsset?: string;
  decimals?: bigint;
  symbol?: string;
  minStake?: bigint;
}) {
  const {
    escrowPtr = ADDR_REGISTRY,
    alreadyActive,
    stakeAsset = ADDR_STAKE_ASSET,
    decimals = 18n,
    symbol = "MOCK",
    minStake = 100n
  } = opts;

  mockReadContract
    .mockResolvedValueOnce(escrowPtr)       // #1 escrow pointer
    .mockResolvedValueOnce(alreadyActive);  // #2 isActive

  if (!alreadyActive) {
    mockReadContract
      .mockResolvedValueOnce(stakeAsset)   // #3 stakeAsset
      .mockResolvedValueOnce(decimals)     // #4 decimals
      .mockResolvedValueOnce(symbol)       // #5 symbol
      .mockResolvedValueOnce(minStake);    // #6 minStake
  }
}

/** Queue a Soroban is_active simulation result. */
function setupSorobanIsActive(active: boolean) {
  mockSimulateTransaction.mockResolvedValueOnce(sorobanBoolRetval(active));
}

/** Queue a successful Soroban register flow. */
function setupSorobanRegister() {
  mockSimulateTransaction.mockResolvedValueOnce({ result: { retval: {} } });
  mockSendTransaction.mockResolvedValue({ status: "PENDING", hash: "SOROBANTXHASH" });
  mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe("registerCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreStellarServerMock();
    mockGetAccount.mockResolvedValue({ sequence: "1", accountId: () => "G123" });
    mockWaitForTransactionReceipt.mockResolvedValue({ gasUsed: 21000n });
    mockWriteContract.mockResolvedValue("0xEVMTXHASH");
  });

  // ─────────────────────────────────────────────────────────────────
  // Acceptance criteria 1: EVM address mismatch → fail, send nothing
  // ─────────────────────────────────────────────────────────────────
  describe("EVM address mismatch", () => {
    it("throws and sends no transaction when HTLCEscrow.resolverRegistry() differs from config", async () => {
      __setMockConfig(BASE_CONFIG);

      mockReadContract
        .mockResolvedValueOnce(ADDR_WRONG)  // escrow points to wrong registry
        .mockResolvedValueOnce(false);       // (unused — never reached)

      await expect(registerCommand(undefined, {})).rejects.toThrow(/EVM address mismatch/);

      expect(mockWriteContract).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Acceptance criteria 2: already registered → send nothing
  // ─────────────────────────────────────────────────────────────────
  describe("already registered on both chains", () => {
    it("does nothing when already active on both EVM and Soroban", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: true });
      setupSorobanIsActive(true);

      await registerCommand(undefined, {});

      expect(mockWriteContract).not.toHaveBeenCalled();
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Acceptance criteria 3a: only EVM missing → register EVM only
  // ─────────────────────────────────────────────────────────────────
  describe("only EVM registration missing", () => {
    it("registers only EVM when EVM is inactive but Soroban is already active", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: false });
      setupSorobanIsActive(true);

      await registerCommand(undefined, {});

      // approve + register = 2 writes
      expect(mockWriteContract).toHaveBeenCalledTimes(2);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Acceptance criteria 3b: only Soroban missing → register Soroban only
  // ─────────────────────────────────────────────────────────────────
  describe("only Soroban registration missing", () => {
    it("registers only Soroban when Soroban is inactive but EVM is already active", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: true });
      setupSorobanIsActive(false);
      setupSorobanRegister();

      await registerCommand(undefined, {});

      expect(mockWriteContract).not.toHaveBeenCalled();
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Acceptance criteria 4: dry-run → send nothing
  // ─────────────────────────────────────────────────────────────────
  describe("dry-run mode", () => {
    it("sends no transactions even when both sides need registration", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: false });
      setupSorobanIsActive(false);

      await registerCommand(undefined, { dryRun: true });

      expect(mockWriteContract).not.toHaveBeenCalled();
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it("resolves without throwing (reads state, emits plan log)", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: false });
      setupSorobanIsActive(false);

      await expect(registerCommand(undefined, { dryRun: true })).resolves.toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Happy path: both sides need registration
  // ─────────────────────────────────────────────────────────────────
  describe("full registration (both sides missing)", () => {
    it("registers on both EVM and Soroban when both are inactive", async () => {
      __setMockConfig(BASE_CONFIG);

      setupEvmMocks({ alreadyActive: false });
      setupSorobanIsActive(false);
      setupSorobanRegister();

      await registerCommand(undefined, {});

      expect(mockWriteContract).toHaveBeenCalledTimes(2); // approve + register on EVM
      expect(mockSendTransaction).toHaveBeenCalledTimes(1); // register on Soroban
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Soroban not configured → EVM-only
  // ─────────────────────────────────────────────────────────────────
  describe("Soroban not configured", () => {
    it("registers only EVM when Soroban config is absent", async () => {
      __setMockConfig({
        ...BASE_CONFIG,
        soroban: {
          ...BASE_CONFIG.soroban,
          resolverRegistry: null,
          resolverSecret: null
        }
      });

      setupEvmMocks({ alreadyActive: false });

      await registerCommand(undefined, {});

      expect(mockWriteContract).toHaveBeenCalledTimes(2);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // No htlcEscrow → skip escrow pointer check
  // ─────────────────────────────────────────────────────────────────
  describe("no htlcEscrow configured", () => {
    it("skips escrow pointer check and uses config registry address directly", async () => {
      __setMockConfig({
        ...BASE_CONFIG,
        ethereum: { ...BASE_CONFIG.ethereum, htlcEscrow: null }
      });

      // Only the isActive check (no escrow pointer read)
      mockReadContract.mockResolvedValueOnce(true); // isActive → already active

      setupSorobanIsActive(true);

      await registerCommand(undefined, {});

      expect(mockWriteContract).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Soroban simulation error propagates
  // ─────────────────────────────────────────────────────────────────
  describe("Soroban simulation error", () => {
    it("throws and does not proceed to EVM registration if Soroban is_active fails", async () => {
      __setMockConfig(BASE_CONFIG);

      // EVM validation passes (not active, would need to register)
      setupEvmMocks({ alreadyActive: false });

      // Soroban is_active simulation errors
      mockSimulateTransaction.mockResolvedValueOnce({ error: "ContractError(4)" });

      await expect(registerCommand(undefined, {})).rejects.toThrow(
        /Soroban is_active simulation failed/
      );

      // EVM writes must NOT happen since Soroban validation threw
      expect(mockWriteContract).not.toHaveBeenCalled();
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Missing required config
  // ─────────────────────────────────────────────────────────────────
  describe("missing config", () => {
    it("throws when EVM resolver registry is not configured", async () => {
      __setMockConfig({
        ...BASE_CONFIG,
        ethereum: { ...BASE_CONFIG.ethereum, resolverRegistry: null }
      });

      await expect(registerCommand()).rejects.toThrow(/ETH_RESOLVER_REGISTRY/);
    });

    it("throws when EVM private key is not configured", async () => {
      __setMockConfig({
        ...BASE_CONFIG,
        ethereum: { ...BASE_CONFIG.ethereum, resolverPrivateKey: null }
      });

      await expect(registerCommand()).rejects.toThrow(/RESOLVER_ETH_PRIVATE_KEY/);
    });
  });
});
