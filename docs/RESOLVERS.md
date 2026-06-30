# Running a Community Resolver

OverSync is designed so the relayer (now called the **coordinator**) is
not a privileged operator — anyone can run a resolver and earn fees by
filling cross-chain swap orders, provided they post stake into the
`ResolverRegistry`.

This document explains how to run one.

## What a resolver does

A resolver:

1. Watches both the Ethereum `HTLCEscrow` and the Soroban `HTLC`
   contracts for new orders.
2. Decides whether to fill an order (the policy is up to the operator —
   the reference implementation simply observes; a production resolver
   adds margin checks, inventory management, etc).
3. Locks the counterpart asset on the destination chain.
4. Watches for the user's secret reveal on either side.
5. Submits the secret on the other side to claim its payout + safety
   deposit.

Crucially, a resolver **cannot steal user funds**. All movements are
gated by the HTLC's hashlock + timelock; the worst case for a
misbehaving resolver is forfeiting its own stake via on-chain slashing.

## Prerequisites

- Node.js 20+
- Docker (optional, for the reference image)
- Ethereum RPC URL (Infura recommended) for the network you're running on
- Soroban RPC URL (`https://soroban-testnet.stellar.org` for testnet)
- A funded Ethereum address (gas + stake asset)
- A funded Stellar account (for Soroban auth + transaction fees)

## 1. Configure

Copy the example env file from the repo root:

```bash
cp env.example .env
```

Set at least these variables:

```
NETWORK_MODE=testnet
INFURA_API_KEY=<your_infura_project_key>
# or: SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<key>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ETH_HTLC_ESCROW_TESTNET=<from deployments.testnet.json>
ETH_RESOLVER_REGISTRY_TESTNET=<from deployments.testnet.json>
SOROBAN_HTLC_TESTNET=<from deployments.testnet.json>
SOROBAN_RESOLVER_REGISTRY_TESTNET=<from deployments.testnet.json>
RESOLVER_ETH_PRIVATE_KEY=0x<your_eth_key>
RESOLVER_STELLAR_SECRET=S<your_stellar_secret>
```

## 1.5. Readiness check (dry-run, no funds moved)

Before you stake or run the resolver, sanity-check your local setup with the
readiness command. It is a **read-only** dry-run that:

- validates `NETWORK_MODE`;
- pings the EVM RPC (`eth_chainId`) and the Stellar/Soroban RPC (`getLatestLedger`);
- verifies the EVM + Soroban `ResolverRegistry` addresses are configured;
- derives and prints your resolver EVM address and Stellar public key — **never**
  printing the private key or Stellar secret itself;
- prints an explicit "dry-run / no funds moved" assertion.

It exits **non-zero** when any required item is missing or malformed, so it can
be wired into onboarding scripts and CI.

```bash
pnpm --filter @oversync/resolver readiness
# equivalent build step:
# pnpm --filter @oversync/resolver build
# node resolver/dist/index.js readiness
```

Sample output:

```
=== OverSync Resolver Readiness ===
Network      : testnet
EVM address  : 0xabc... (chainId=11155111)
Stellar addr : Gxyz...
Mode         : DRY-RUN — no transactions submitted, no funds moved
...
Result: READY — this environment looks correct for a resolver operator.
Next step: `pnpm --filter @oversync/resolver register` to stake and activate.
```

## 2. Register

You need to post the minimum stake (configurable per-deployment) into
the on-chain registry before the coordinator will route orders to you.

```bash
cd resolver
pnpm install
pnpm build

# Use the registry's minStake.
node dist/index.js register

# Or supply a custom amount (in the stake asset's units).
node dist/index.js register 250

# Check your status.
node dist/index.js status
```

## 3. Run

Foreground:

```bash
node dist/index.js run
```

Docker:

```bash
docker build -t oversync-resolver .
docker run --rm --env-file ../.env oversync-resolver run
```

## 4. Withdraw

If you stop running the resolver, withdraw your stake:

```bash
node dist/index.js unregister
```

Note: a resolver that misbehaves can be slashed by the registry owner
(a multisig or DAO). Slashed stake goes to the configured beneficiary.
The current reference deployment uses the deploying address as
slash beneficiary on testnet — see
[`docs/TRUST_MODEL.md`](TRUST_MODEL.md) for production governance plans.

## Security checklist

- **Hot wallets only**. Do not run the resolver from a key that holds
  funds beyond what's needed for gas + active escrow inventory.
- **Air-gap the cold treasury**. Use a separate signer to top up the
  hot wallet.
- **Monitor your stake**. If your stake drops below `minStake` (e.g.
  after a slash event) the registry's `isActive` returns false and you
  will stop receiving order assignments.
- **Run the latest version**. Subscribe to security advisories at
  `https://github.com/karagozemin/OverSync-1nchFusion/security`.
