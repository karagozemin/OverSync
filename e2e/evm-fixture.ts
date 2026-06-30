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
import { spawn, type ChildProcess } from "node:child_process";
import { ethers } from "ethers";

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
const ZERO_ADDR = ethers.ZeroAddress;
const HARDHAT_RPC = "http://127.0.0.1:8545";
const DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BENEFICIARY_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RealEvmHtlcFixture {
  createOrder(hashlock: Hex, timelockSeconds: number): Promise<bigint>;
  claimOrder(orderId: bigint, preimage: Hex): Promise<void>;
  claimOrderExpectRevert(orderId: bigint, preimage: Hex): Promise<string>;
  getOrderStatus(orderId: bigint): Promise<"Funded" | "Claimed" | "Refunded">;
  stop(): Promise<void>;
}

const STATUS_MAP = ["Funded", "Claimed", "Refunded"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function decodeCustomError(abi: unknown[], data: string | undefined): string | null {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const iface = new ethers.Interface(abi);
  for (const fragment of iface.fragments) {
    if (fragment.type === "error") {
      const computed = iface.getError(fragment.name)?.selector;
      if (computed?.toLowerCase() === selector) return fragment.name;
    }
  }
  return null;
}

/** Spawn a Hardhat node and wait until it is ready to accept connections. */
async function spawnHardhatNode(): Promise<ChildProcess> {
  const contractsDir = join(__dirname, "../contracts");

  const node = spawn("pnpm", ["hardhat", "node"], {
    cwd: contractsDir,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
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
  // Spawn a fresh Hardhat node for this test
  const nodeProcess = await spawnHardhatNode();

  const provider = new ethers.JsonRpcProvider(HARDHAT_RPC, undefined, {
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

    async stop(): Promise<void> {
      await provider.destroy();
      nodeProcess.kill();
      // Give the process a moment to clean up the port
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}