import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outputPath = resolve(repoRoot, "docs/scf-testnet-metrics.json");
const deploymentsPath = resolve(repoRoot, "deployments.testnet.json");
const command = "pnpm scf:testnet-metrics";
const timeoutMs = Number(process.env.SCF_METRICS_TIMEOUT_MS ?? 5_000);

function explorerLinks(deployments) {
  const eth = deployments.ethereum.contracts;
  const stellar = deployments.stellar.contracts;
  const stellarTxs = deployments.stellar.deployTransactions ?? {};

  return {
    ethereum: {
      chainId: deployments.ethereum.chainId,
      name: deployments.ethereum.name,
      contracts: {
        HTLCEscrow: {
          address: eth.HTLCEscrow,
          explorerUrl: `https://sepolia.etherscan.io/address/${eth.HTLCEscrow}`
        },
        ResolverRegistry: {
          address: eth.ResolverRegistry,
          explorerUrl: `https://sepolia.etherscan.io/address/${eth.ResolverRegistry}`
        }
      },
      deployedAt: deployments.ethereum.deployedAt
    },
    stellar: {
      network: "testnet",
      contracts: {
        HTLC: {
          id: stellar.HTLC,
          explorerUrl: `https://stellar.expert/explorer/testnet/contract/${stellar.HTLC}`,
          deployTransaction: stellarTxs.HTLC
            ? `https://stellar.expert/explorer/testnet/tx/${stellarTxs.HTLC}`
            : null
        },
        ResolverRegistry: {
          id: stellar.ResolverRegistry,
          explorerUrl: `https://stellar.expert/explorer/testnet/contract/${stellar.ResolverRegistry}`,
          deployTransaction: stellarTxs.ResolverRegistry
            ? `https://stellar.expert/explorer/testnet/tx/${stellarTxs.ResolverRegistry}`
            : null
        }
      },
      deployedAt: deployments.stellar.deployedAt
    }
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      ok: response.ok,
      status: response.status,
      url,
      body
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      url,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function coordinatorMeasurements() {
  const baseUrl = process.env.SCF_COORDINATOR_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    return {
      health: {
        status: null,
        checkedUrl: null,
        reason: "SCF_COORDINATOR_URL is not set, so no public coordinator health endpoint was checked."
      },
      orderCounts: {
        total: null,
        byStatus: null,
        checkedUrl: null,
        reason: "No public aggregate order-count endpoint is committed. The history endpoint is address-scoped."
      }
    };
  }

  const health = await fetchJson(`${baseUrl}/health`);
  return {
    health: {
      status: health.ok ? health.body?.status ?? "ok" : null,
      checkedUrl: health.url,
      httpStatus: health.status,
      response: health.ok ? health.body : null,
      reason: health.ok ? null : health.error ?? `HTTP ${health.status}`
    },
    orderCounts: {
      total: null,
      byStatus: null,
      checkedUrl: null,
      reason: "No public aggregate order-count endpoint is committed. The history endpoint is address-scoped."
    }
  };
}

async function main() {
  const deployments = JSON.parse(await readFile(deploymentsPath, "utf8"));
  const coordinator = await coordinatorMeasurements();

  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: {
      command,
      environment: {
        SCF_COORDINATOR_URL: process.env.SCF_COORDINATOR_URL ?? null,
        SCF_METRICS_TIMEOUT_MS: String(timeoutMs)
      }
    },
    network: deployments.network,
    sources: {
      deployments: "deployments.testnet.json",
      tractionDoc: "docs/TRACTION.md"
    },
    deployments: explorerLinks(deployments),
    measurements: {
      coordinator,
      registeredResolvers: {
        ethereum: {
          count: null,
          registry: deployments.ethereum.contracts.ResolverRegistry,
          reason: "Not fetched by this lightweight script; record null rather than depending on an unavailable ABI/RPC helper."
        },
        stellar: {
          count: null,
          registry: deployments.stellar.contracts.ResolverRegistry,
          reason: "Not fetched by this lightweight script; record null rather than depending on an unavailable Soroban RPC helper."
        }
      },
      latestSuccessfulDemoTransactions: {
        ethereumToStellar: null,
        stellarToEthereum: null,
        reason: "No already-known successful demo transaction links are committed in this repository."
      }
    },
    guardrails: {
      tvlUsd: null,
      swapVolumeUsd: null,
      uptimePercent: null,
      note: "This snapshot intentionally does not fabricate TVL, uptime, volume, or swap count."
    }
  };

  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
