/**
 * evm-fixture.ts
 *
 * Deploys HTLCEscrow against a Hardhat node that is spawned
 * automatically as a child process — no manual `pnpm hardhat node`
 * required. The node is started in startEvmFixture() and killed in
 * stop(), so the suite is fully self-contained.
 *
 * Prerequisites:
 *   - Run `pnpm --filter @oversync/e2e test` from the repo root.
 *     The pretest script compiles the contracts automatically.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { ethers, type ErrorFragment, type InterfaceAbi } from "ethers";

export type Hex = `0x${string}`;

// ── Load artifact ─────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(
  __dirname,
  "../contracts/artifacts/contracts/v2/HTLCEscrow.sol/HTLCEscrow.json"
);

// ── Constants ─────────────────────────────────────────────────────────────────

const AMOUNT = ethers.parseEther("0.5");
const SAFETY_DEPOSIT = 0n;
/** The escrow value locked per order, exported so tests can assert balances. */
export const ESCROW_AMOUNT = AMOUNT;
const ZERO_ADDR = ethers.ZeroAddress;
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BENEFICIARY_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RealEvmHtlcFixture {
  nextOrderId(): Promise<bigint>;
  createOrder(hashlock: Hex, timelockSeconds: number): Promise<bigint>;
  claimOrder(orderId: bigint, preimage: Hex): Promise<void>;
  claimOrderExpectRevert(orderId: bigint, preimage: Hex): Promise<string>;
  getOrderStatus(orderId: bigint): Promise<"Funded" | "Claimed" | "Refunded">;
  /** Total ETH currently held in escrow by the deployed contract. */
  getEscrowBalance(): Promise<bigint>;
  stop(): Promise<void>;
}

/**
 * The canonical Hardhat/Anvil dev accounts used by this fixture. These are
 * publicly documented test keys with no real funds — the suite never uses a
 * mainnet key. Exported so tests can assert that invariant.
 */
export const HARDHAT_TEST_KEYS = {
  deployer: DEPLOYER_KEY,
  beneficiary: BENEFICIARY_KEY
} as const;

const STATUS_MAP = ["Funded", "Claimed", "Refunded"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeCustomError(abi: InterfaceAbi, data: string | undefined): string | null {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const iface = new ethers.Interface(abi);
  for (const fragment of iface.fragments) {
    if (fragment.type === "error") {
      const errorFragment = fragment as ErrorFragment;
      const computed = iface.getError(errorFragment.name)?.selector;
      if (computed?.toLowerCase() === selector) return errorFragment.name;
    }
  }
  return null;
}

/**
 * Reserve an ephemeral loopback port. Vitest runs test files in parallel, and
 * more than one suite (cross-chain + hashlock parity) starts a Hardhat node;
 * a fixed port would make whichever suite binds second fail with EADDRINUSE.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Spawn a Hardhat node and wait until it is ready to accept connections. */
async function spawnHardhatNode(port: number): Promise<ChildProcess> {
  const contractsDir = join(__dirname, "../contracts");

  const node = spawn("pnpm", ["hardhat", "node", "--port", String(port)], {
    cwd: contractsDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    detached: process.platform !== "win32",
  });

  // Wait until the node prints its ready message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Hardhat node did not start within 30s"));
    }, 30_000);

    node.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Started HTTP and WebSocket JSON-RPC server")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    node.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        clearTimeout(timeout);
        reject(new Error(`Hardhat node error: ${msg}`));
      }
    });

    node.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Hardhat node exited with code ${code}`));
    });
  });

  return node;
}

// ── Fixture ───────────────────────────────────────────────────────────────────

export async function startEvmFixture(): Promise<RealEvmHtlcFixture> {

  // Load artifact here, not at module level — ensures pretest compile runs first
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const HTLC_ABI = artifact.abi;
  const HTLC_BYTECODE = artifact.bytecode as string;
  // Spawn a fresh Hardhat node for this test on a port owned by this fixture.
  const port = await findFreePort();
  const nodeProcess = await spawnHardhatNode(port);

  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`, undefined, {
    cacheTimeout: -1,
    polling: true,
  });

  const deployerWallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const beneficiaryWallet = new ethers.Wallet(BENEFICIARY_KEY, provider);
  const deployer = new ethers.NonceManager(deployerWallet);
  const beneficiary = new ethers.NonceManager(beneficiaryWallet);

  // Deploy HTLCEscrow(address(0), 0) — permissionless, no min deposit
  const factory = new ethers.ContractFactory(HTLC_ABI, HTLC_BYTECODE, deployer);
  const contract = await factory.deploy(ZERO_ADDR, 0n);
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  deployer.reset();
  beneficiary.reset();

  const escrow = new ethers.Contract(contractAddress, HTLC_ABI, deployer);
  const escrowAsBeneficiary = new ethers.Contract(contractAddress, HTLC_ABI, beneficiary);

  return {
    async nextOrderId(): Promise<bigint> {
      return await escrow.nextOrderId();
    },

    async createOrder(hashlock: Hex, timelockSeconds: number): Promise<bigint> {
      const total = AMOUNT + SAFETY_DEPOSIT;
      deployer.reset();

      const tx = await escrow.createOrder(
        beneficiaryWallet.address,
        deployerWallet.address,
        ZERO_ADDR,
        AMOUNT,
        SAFETY_DEPOSIT,
        hashlock,
        timelockSeconds,
        { value: total }
      );
      const receipt = await tx.wait();

      const iface = new ethers.Interface(HTLC_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "OrderCreated") {
            return parsed.args.orderId as bigint;
          }
        } catch {
          // skip unparseable logs
        }
      }
      throw new Error("OrderCreated event not found in receipt");
    },

    async claimOrder(orderId: bigint, preimage: Hex): Promise<void> {
      beneficiary.reset();
      const tx = await escrowAsBeneficiary.claimOrder(orderId, preimage);
      await tx.wait();
    },

    async claimOrderExpectRevert(orderId: bigint, preimage: Hex): Promise<string> {
      try {
        await escrowAsBeneficiary.claimOrder.staticCall(orderId, preimage);
        return "";
      } catch (e: any) {
        const rawData: string | undefined = e?.data ?? e?.error?.data;
        const decoded = decodeCustomError(HTLC_ABI, rawData);
        if (decoded) return decoded;
        return e?.errorName ?? e?.reason ?? e?.message ?? String(e);
      }
    },

    async getOrderStatus(orderId: bigint): Promise<"Funded" | "Claimed" | "Refunded"> {
      const order = await escrow.getOrder(orderId);
      return STATUS_MAP[Number(order.status)];
    },

    async getEscrowBalance(): Promise<bigint> {
      return await provider.getBalance(contractAddress);
    },

    async stop(): Promise<void> {
      await provider.destroy();
      if (nodeProcess.exitCode === null && nodeProcess.signalCode === null) {
        const exited = new Promise<void>((resolve) => nodeProcess.once("exit", () => resolve()));
        if (process.platform === "win32") {
          nodeProcess.kill();
        } else if (nodeProcess.pid) {
          process.kill(-nodeProcess.pid, "SIGTERM");
        }
        await exited;
      }
    },
  };
}