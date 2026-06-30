# SCF Demo Transcript — Sepolia ↔ Stellar Testnet

A step-by-step walkthrough of a cross-chain HTLC swap on OverSync v2
testnet. Designed for grant reviewers: follow this from a clean checkout
without reading every service directory.

## Prerequisites

### Wallets

| Wallet | Required for | Install |
|---|---|---|
| MetaMask (or any EIP-1193) | Sepolia ETH lock/claim/refund | [metamask.io](https://metamask.io) |
| Freighter | Stellar testnet XLM lock/claim/refund | [freighter.app](https://freighter.app) |

Add Sepolia to MetaMask if not present:

- **Network name:** Sepolia
- **RPC URL:** `https://ethereum-sepolia-rpc.publicnode.com`
- **Chain ID:** `11155111`
- **Currency:** SepoliaETH

### Faucets

| Asset | Faucet URL | Notes |
|---|---|---|
| SepoliaETH | [alchemy.com/faucets/ethereum-sepolia](https://www.alchemy.com/faucets/ethereum-sepolia) | 0.5 ETH per day, enough for many swaps |
| Stellar testnet XLM | [laboratory.stellar.org/#account-creator](https://laboratory.stellar.org/#account-creator) (friendbot) or `stellar keys fund` | 10 000 XLM per request |

After funding both wallets you should see balances in MetaMask (> 0.1
SepoliaETH) and Freighter (> 500 XLM).

### Required env vars (local demo)

```bash
cp env.example .env
```

Set these minimum values in `.env`:

```bash
NETWORK_MODE=testnet
INFURA_API_KEY=                           # optional, public fallback works
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

The coordinator defaults are fine for local development:

```
COORDINATOR_PORT=3001
DATABASE_URL=file:./oversync.db
```

### Live contract addresses (testnet)

All testnet deployments are recorded in
[`deployments.testnet.json`](../deployments.testnet.json). The coordinator
reads them from env vars; for local runs you must set these in `.env`:

```bash
ETH_HTLC_ESCROW_TESTNET=0xb352339BEb146f2699d28D736700B953988bB178
ETH_RESOLVER_REGISTRY_TESTNET=0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99
SOROBAN_HTLC_TESTNET=CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK
SOROBAN_RESOLVER_REGISTRY_TESTNET=CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF
```

> **Source:** [`deployments.testnet.json`](../deployments.testnet.json)

## Services to run locally

You need the coordinator (order book + chain listeners). A resolver is
optional — the coordinator includes a reference resolver, or you can skip
it and observe the happy path through the frontend only.

### 1. Coordinator

```bash
cd coordinator
pnpm install             # first time only
pnpm dev                 # starts on :3001
```

The coordinator boots, applies the SQLite schema, and begins polling both
chains for `OrderCreated` / `OrderClaimed` / `OrderRefunded` events.

**Verification:**

```bash
curl http://localhost:3001/health
# → {"status":"ok","uptime":42,"version":"0.1.0"}
```

> **Source:** [`coordinator/src/index.ts`](../coordinator/src/index.ts)

### 2. Frontend (development mode)

```bash
cd frontend
pnpm install             # first time only
pnpm dev                 # starts on :5173
```

Open `http://localhost:5173` in a browser. You should see the OverSync UI
with **Testnet** selected — mainnet appears disabled.

> **Source:** [`frontend/vite.config.ts`](../frontend/vite.config.ts),
> [`env.example`](../env.example)

### 3. Reference resolver (optional for demo)

A resolver locks the counterpart leg automatically. Without one the swap
stalls at `src_locked` — the frontend will still show the order and you
can manually inspect it.

```bash
cd resolver
pnpm install
pnpm build
node dist/index.js run
```

> **Source:** [`docs/RESOLVERS.md`](RESOLVERS.md),
> [`resolver/`](../resolver/)

## Demo A: ETH → XLM (happy path)

This is the primary demo scenario.

### Step 1 — Connect wallets

1. In the OverSync UI (`http://localhost:5173`) click **Connect Wallet**.
2. Select **MetaMask** for Ethereum. Approve the connection for Sepolia.
3. Click **Connect Stellar** and approve in Freighter.

Both avatars should show connected with the network badge "Sepolia" /
"Testnet".

### Step 2 — Initiate swap

1. Set direction to **Ethereum → Stellar** (default).
2. Enter amount: `0.01` ETH.
3. The UI shows an estimated XLM output (fetched from
   `GET /api/quotes/eth-xlm`).
4. Click **Swap**.

### Step 3 — Review & sign

The frontend calls `POST /api/orders/announce` on the coordinator
[`coordinator/src/server/routes/orders.ts`](../coordinator/src/server/routes/orders.ts).

The coordinator generates a random 32-byte secret, computes
`sha256(secret)`, stores the hashlock, and returns an `order` object
with a `publicId` and recommended timelocks:

- **Source timelock:** 24 hours (ETH side)
- **Destination timelock:** 12 hours (XLM side)

MetaMask opens asking you to sign the `createOrder` transaction on the
`HTLCEscrow` contract at
[`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol).

Review and confirm. The coordinator's
[`EthereumListener`](../coordinator/src/listeners/ethereum-listener.ts)
detects the `OrderCreated` event and updates the order status to
`src_locked`.

### Step 4 — Lock XLM on Stellar (resolver)

If a resolver is running, it detects the `src_locked` order via the
coordinator, verifies the source-side lock is finalised, then calls
`oversync-htlc::create_order` on Stellar testnet to lock the equivalent
XLM. The coordinator's
[`SorobanListener`](../coordinator/src/listeners/soroban-listener.ts)
updates the order to `dst_locked`.

**Without a resolver:** the swap stops here. You can still observe the
order in the frontend history. To proceed, run the reference resolver
(see above) or wait for a community resolver to pick it up.

### Step 5 — Claim XLM

The frontend shows the order as ready to claim. Click **Claim**.
Freighter opens asking you to sign `claim_order` with the secret
preimage — this reveals the preimage on Stellar.

After confirmation, XLM arrives in your Stellar wallet. The coordinator
records the secret reveal at `POST /api/secrets/reveal`
[`coordinator/src/server/routes/secrets.ts`](../coordinator/src/server/routes/secrets.ts).

### Step 6 — Resolver claims ETH

Once the preimage is public, the resolver (or coordinator relay) calls
`HTLCEscrow.claimOrder` on Sepolia to claim the locked ETH. The order
reaches terminal status `completed`.

The full lifecycle:

```
announced → src_locked → dst_locked → secret_revealed → completed
```

> **State machine source:**
> [`packages/sdk/src/state-machine/index.ts`](../packages/sdk/src/state-machine/index.ts)

## Demo B: XLM → ETH (reverse direction)

### Step 1 — Connect wallets (same as Demo A)

### Step 2 — Initiate reverse swap

1. Set direction to **Stellar → Ethereum**.
2. Enter amount (e.g. `100` XLM).
3. Click **Swap**.

### Step 3 — Lock XLM on Stellar (user signs)

Freighter opens asking you to sign `create_order` on the Soroban
`oversync-htlc` contract with a 24-hour timelock.

### Step 4 — Resolver locks ETH on Sepolia

The resolver detects the `src_locked` order and locks the equivalent ETH
on Sepolia with a 12-hour timelock (shorter than source, preserving the
atomicity invariant).

### Step 5 — Claim ETH

The UI shows the order ready. Click **Claim**. MetaMask opens asking you
to sign `claimOrder` on Sepolia — this reveals the preimage on Ethereum.

### Step 6 — Resolver claims XLM

The resolver claims the locked XLM using the now-public preimage.

## Explorer links

| Chain | Explorer | Example query |
|---|---|---|
| Sepolia | [sepolia.etherscan.io](https://sepolia.etherscan.io) | `https://sepolia.etherscan.io/address/0xb352339BEb146f2699d28D736700B953988bB178` (HTLC contract) |
| Stellar testnet | [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet) | `https://stellar.expert/explorer/testnet/contract/CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK` (HTLC contract) |

To find a specific transaction:

- **Sepolia:** in MetaMask activity log, click the swap transaction →
  "View on block explorer"
- **Stellar:** in Freighter activity log, click the swap transaction →
  "View on explorer"

Alternatively, use the coordinator API:

```bash
# List orders for your address
curl http://localhost:3001/api/orders/history?address=0xYourEthereumAddress

# Get full order detail
curl http://localhost:3001/api/orders/<publicId>
```

## Verifying the hashlock / preimage relationship

The atomicity of the swap depends on a single secret. Here is how to
verify it manually:

1. **Find the hashlock.** After announcing, the order object contains
   `hashlock` — a 66-character hex string starting with `0x`. Fetch it:
   ```bash
   curl http://localhost:3001/api/orders/<publicId> | jq .hashlock
   ```

2. **Find the revealed preimage.** After the claim, the secret endpoint
   returns the plaintext preimage:
   ```bash
   curl http://localhost:3001/api/secrets/<publicId> | jq .preimage
   ```

3. **Verify the hash.** The preimage's sha256 should match the hashlock:
   ```bash
   # Node.js one-liner
   node -e "const { createHash } = require('crypto'); \
     const preimage = '<preimage from step 2>'; \
     const hash = '0x' + createHash('sha256').update(Buffer.from(preimage.slice(2), 'hex')).digest('hex'); \
     console.log('Matches:', hash === '<hashlock from step 1>');"
   ```

> **Source:** [`packages/sdk/src/secrets/index.ts`](../packages/sdk/src/secrets/index.ts)

The `generateSecret()` and `hashSecret()` functions in the SDK do
exactly this — the coordinator uses them at announce time.

## Failure scenarios

### Coordinator offline

If the coordinator is unreachable:

- Existing orders already on-chain continue to their timelock expiry.
  The HTLC contracts are **fully permissionless** — claims and refunds
  are signed directly in the user's wallet and submitted to the chain,
  bypassing the coordinator entirely.
- New swaps cannot be announced (the frontend POST to
  `/api/orders/announce` fails). Users can still manually interact with
  the HTLC contract via Etherscan or Soroban RPC.

**Recovery:** restart the coordinator. It replays historical events
from both chains on boot and recovers all in-flight orders.

**Source:** [`coordinator/src/listeners/`](../coordinator/src/listeners/)

### Resolver offline

If no resolver is online to fill the counterpart leg:

- The swap stalls at `src_locked`. The user's funds are safely held in
  the HTLC contract.
- The user can **refund** after the source-side timelock expires (24
  hours for the first leg).
- To proceed without a resolver, either run the reference resolver (see
  above) or wait for a community resolver.

### Refund flow (non-custodial)

Refunds are fully permissionless — no coordinator or resolver involvement
required.

#### ETH → XLM (user refunds ETH after 24h timelock)

1. Open the order in **Transaction History**.
2. Click **Refund** (available only after timelock expiry).
3. MetaMask opens asking you to sign `refundOrder` on the Sepolia
   `HTLCEscrow` contract.
4. ETH returns to your wallet.

You can also refund directly without the UI:

```bash
# Etherscan → Contract → Write Contract → refundOrder
# Connect wallet, enter the order ID, write.
```

Or using the SDK in a Node.js script:
[`packages/sdk/src/ethereum/index.ts`](../packages/sdk/src/ethereum/index.ts)

#### XLM → ETH (user refunds XLM after 24h timelock)

1. In Transaction History, click **Refund**.
2. Freighter opens asking you to sign `refund_order` on the Soroban
   `oversync-htlc` contract.
3. XLM returns to your wallet.

The inline XLM refund helper runs automatically for failed XLM→ETH swaps:
[`relayer/src/xlm-refund.ts`](../relayer/src/xlm-refund.ts)

### Refund verification

After submitting the refund transaction:

1. Check the order status via the coordinator:
   ```bash
   curl http://localhost:3001/api/orders/<publicId> | jq .status
   # → "refunded"
   ```

2. On-chain verification:
   - **Sepolia:** search your address on [sepolia.etherscan.io](https://sepolia.etherscan.io) — the `RefundOrder` event log contains the order ID.
   - **Stellar:** search your address on [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet) — the `refund_order` operation shows the refund.

3. Your wallet balance reflects the returned funds (minus gas).

### Timelock atomicity guarantee

The timelock invariant ensures no intermediate state is possible:

```
Source leg (24h) ──────────────────────────┐
                                            ├── Both settle or both refund
Destination leg (12h) ────────────┐         │
                                  │         │
                          Refund possible   Refund possible
                          on destination    on source
```

If the destination-side resolver never locks, the source side refunds
after 24h. If the resolver locks but the user never claims, the resolver
refunds destination first (12h), then the user refunds source (24h).
Neither party can lock funds permanently. See
[`docs/TRUST_MODEL.md`](TRUST_MODEL.md) for the full threat analysis.

> **Source:**
> [`packages/sdk/src/state-machine/index.ts`](../packages/sdk/src/state-machine/index.ts),
> [`coordinator/src/state-machine/order-machine.ts`](../coordinator/src/state-machine/order-machine.ts)

## Architecture reference

| Layer | Location | Purpose |
|---|---|---|
| HTLC contracts | [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol), [`soroban/contracts/htlc/`](../soroban/contracts/htlc/) | On-chain escrow (EVM + Soroban) |
| SDK | [`packages/sdk/src/`](../packages/sdk/src/) | Shared types, secret utils, chain clients |
| Coordinator | [`coordinator/src/`](../coordinator/src/) | Order book HTTP API, chain listeners, persistence |
| Frontend | [`frontend/src/`](../frontend/src/) | React UI with wallet connectors |
| Resolver | [`resolver/`](../resolver/) | Permissionless fill agent |
| Resolver registry | [`contracts/contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol), [`soroban/contracts/resolver-registry/`](../soroban/contracts/resolver-registry/) | On-chain resolver staking |
| Deployment | [`docs/DEPLOYMENT.md`](DEPLOYMENT.md), [`deployments.testnet.json`](../deployments.testnet.json) | Contract addresses, deploy scripts |
| Architecture overview | [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Full system design |
| Trust model | [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) | Per-actor threat analysis |
