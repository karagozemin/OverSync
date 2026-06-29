# Resolver Partner Onboarding Packet

This packet defines everything a third-party resolver operator needs to
go from an empty environment to a passing testnet dry-run on OverSync's
open resolver network. It is the canonical reference for the first three
community resolvers being onboarded under the SCF Tranche 2 resolver
onboarding grant programme.

---

## 1. Target Resolver Profile

OverSync's open resolver network is designed for operators who already
run infrastructure in the cross-chain / MEV / solver space. The ideal
candidate looks like one of:

| Profile | Why they are a good fit |
|---|---|
| **Existing 1inch Fusion+ resolver operator** | Same operational pattern (per-order escrow, secret-reveal, open registry). Adding Stellar is a marginal infrastructure cost. |
| **Stellar ecosystem participant** (validator, anchor, DEX market maker) | Already familiar with Stellar RPC, Horizon, and asset management. The EVM side is the new surface area. |
| **Professional MEV / searcher team** | Comfortable with fast RPC infrastructure, multi-chain inventory management, and gas optimisation. No new operational patterns to learn. |

Non-target profiles for the initial onboarding wave:

- Solo retail operators without dedicated infra (the resolver must run
  24/7 and respond within seconds to fill windows).
- Teams unwilling to post at least the minimum on-chain stake
  (currently 100 XLM equivalent on testnet; mainnet stake will be
  higher).

---

## 2. Minimum Infrastructure Requirements

### 2.1 Compute

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| Storage | 20 GB SSD | 40 GB SSD |
| OS | Linux (any modern distro) | Ubuntu 24.04 LTS or Debian 12 |

The resolver runner is a single-threaded TypeScript process. The docker
image is the primary distribution mechanism.

### 2.2 Network

- **Ethereum RPC (Sepolia testnet)**: An Infura, Alchemy, or self-hosted
  RPC endpoint. Public RPCs (e.g.
  `https://ethereum-sepolia-rpc.publicnode.com`) are acceptable for
  testnet but will introduce latency. Mainnet will require a paid RPC
  plan.
- **Soroban RPC (Stellar testnet)**:
  `https://soroban-testnet.stellar.org` — the Stellar Foundation's
  public endpoint is sufficient for testnet.
- **Outbound connectivity**: HTTPS (TCP/443), WebSocket (TCP/443) to
  RPC endpoints. No inbound ports required — the resolver is
  pull-based.
- **Uptime target**: 99% for testnet; 99.9% expected for mainnet.

### 2.3 Wallets / Keys

| Key | Purpose | Security level |
|---|---|---|
| `RESOLVER_ETH_PRIVATE_KEY` | Gas + stake on EVM chain | Hot wallet — hold only what is needed for gas + active escrow inventory |
| `RESOLVER_STELLAR_SECRET` | Auth + tx fees on Soroban | Hot wallet — same principle |

The resolver runner does **not** require admin keys, treasury keys, or
any keys that can move user funds.

### 2.4 Software

- Node.js 20+ (or Docker)
- Docker (recommended for the reference image)
- `pnpm` 8+ (only needed for building from source)

---

## 3. Stake / Funding Assumptions

### 3.1 Minimum Stake

| Network | Asset | Amount | Address / ID |
|---|---|---|---|
| Sepolia (testnet) | ETH (for gas only; stake is native XLM SAC) | 0 ETH staked on EVM side | Registry: `0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99` |
| Stellar (testnet) | native XLM SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) | 100 XLM (`1000000000` units) | Registry: `CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF` |

The resolver stakes into the **Soroban-side** `ResolverRegistry`. The
minimum stake is 100 XLM-equivalent SAC. On testnet these are test
tokens with no monetary value.

### 3.2 Gas Budget (Testnet, per month)

| Chain | Estimated monthly cost |
|---|---|
| Sepolia | ~0.01 ETH in gas (test ETH, no real cost) |
| Stellar testnet | ~500 XLM in tx fees (test XLM, no real cost) |

Testnet faucets:
- **Sepolia ETH**: https://sepoliafaucet.com or https://faucet.quicknode.com/ethereum/sepolia
- **Stellar testnet XLM**: https://friendbot.stellar.org (send a POST to
  `https://friendbot.stellar.org?addr=<your_public_key>`)

### 3.3 Mainnet Projections (for planning)

| Item | Estimate | Notes |
|---|---|---|
| Minimum stake | TBD (expected 1,000–10,000 XLM) | To be set before mainnet launch; balances security vs. barrier to entry |
| Monthly gas (Ethereum) | ~0.05–0.2 ETH | Depends on order volume |
| Monthly tx fees (Stellar) | ~100–500 XLM | Stellar fees are negligible relative to Ethereum |
| Inventory float | 0.5–2 ETH | Needed to fill orders (escrowed per-order; returned on settlement) |

---

## 4. Testnet Registration Checklist

Use this checklist to go from zero to a registered resolver on testnet.

### 4.1 Pre-work

- [ ] **Read** [`docs/RESOLVERS.md`](RESOLVERS.md) — the running guide.
- [ ] **Read** [`ARCHITECTURE.md`](../ARCHITECTURE.md) — understand the
      full system.
- [ ] **Read** [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) — understand
      what a resolver can and cannot do.
- [ ] **Fund two wallets** — one Ethereum (Sepolia) address with test
      ETH, one Stellar account with test XLM.
- [ ] **Install** Node.js 20+ and Docker.

### 4.2 Environment setup

- [ ] **Clone** the repository:
      `git clone https://github.com/karagozemin/OverSync.git`
- [ ] **Copy** env file: `cp env.example .env`
- [ ] **Set** `NETWORK_MODE=testnet`
- [ ] **Set** `INFURA_API_KEY` or `SEPOLIA_RPC_URL` to a working RPC
- [ ] **Set** `SOROBAN_RPC_URL=https://soroban-testnet.stellar.org`
- [ ] **Set** contract addresses from `deployments.testnet.json`:
  - `ETH_RESOLVER_REGISTRY_TESTNET=0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99`
  - `ETH_HTLC_ESCROW_TESTNET=0xb352339BEb146f2699d28D736700B953988bB178`
  - `SOROBAN_RESOLVER_REGISTRY_TESTNET=CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF`
  - `SOROBAN_HTLC_TESTNET=CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK`
- [ ] **Set** `RESOLVER_ETH_PRIVATE_KEY=0x<your_eth_key>`
- [ ] **Set** `RESOLVER_STELLAR_SECRET=S<your_stellar_secret>`

### 4.3 Build and register

- [ ] **Install deps + build**:
      ```bash
      cd resolver
      pnpm install
      pnpm build
      ```
- [ ] **Check wallet balances**:
      ```bash
      node dist/index.js status
      ```
      Both addresses should show non-zero balances.
- [ ] **Register (stake)**:
      ```bash
      node dist/index.js register
      ```
      This uses the on-chain `minStake`. On testnet this is 100 XLM SAC.
- [ ] **Verify registration**:
      ```bash
      node dist/index.js status
      ```
      Output should show `registered: true` and your active stake.

---

## 5. Dry-Run Fill Checklist

Once registered, a resolver must demonstrate it can actually fill orders
end-to-end.

### 5.1 Passive dry-run (watch mode)

Before taking real orders, run the resolver in observer mode to verify
it can connect to both chains and the coordinator:

- [ ] **Start resolver**:
      ```bash
      node dist/index.js run
      ```
- [ ] **Verify** the resolver logs:
  - `Connected to EVM HTLCEscrow at <address>`
  - `Connected to Soroban HTLC at <address>`
  - `Subscribed to coordinator order feed`
- [ ] **Let it run** for 15 minutes. No crashes, no reconnect loops.
- [ ] **Stop** the resolver with Ctrl+C — clean shutdown, no hanging
      process.

### 5.2 Active fill dry-run

- [ ] **Start resolver** in one terminal:
      ```bash
      node dist/index.js run
      ```
- [ ] **Initiate a test swap** via the public frontend at
      `https://testnet.oversync.app` or by calling the SDK directly:
      - Swap 0.001 ETH → XLM (smallest practical amount)
      - Swap 100 XLM → ETH
- [ ] **Verify** the resolver logs an incoming order:
      `New order detected: <orderId>`
- [ ] **Verify** the resolver locks the counterpart asset:
      `Locked <amount> on <destination chain> for order <orderId>`
- [ ] **Verify** the resolver claims the payout after the user reveals:
      `Claimed payout for order <orderId> — preimage submitted`
- [ ] **Repeat** for the reverse direction (XLM → ETH).
- [ ] **Verify** no errors, no missed deadlines, no incorrect fills.

### 5.3 Recovery dry-run

- [ ] **Initiate a swap** but do not complete it (let timelock expire).
- [ ] **Verify** the resolver does **not** attempt to claim an expired
      order (it should skip or log rejection).
- [ ] **Verify** the user's funds are refundable via on-chain
      `refundOrder` (permissionless — does not depend on the resolver).

### 5.4 Registration verification with coordinator

- [ ] **Confirm** the coordinator's `/api/resolvers/active` endpoint
      lists your resolver address.
- [ ] **Confirm** `node dist/index.js status` shows `registered: true`.

---

## 6. Support and Escalation Channels

### 6.1 During testnet onboarding

| Channel | Purpose | Expected response |
|---|---|---|
| **GitHub Issues** — `https://github.com/karagozemin/OverSync/issues` | Bug reports, feature requests, clarification | 24–48 hours |
| **Discord** — Stellar Dev Discord `#oversync` channel | Real-time help during onboarding | Business hours (UTC day) |
| **Email** — `resolver@oversync.app` | Private / key-related queries | 48 hours |

### 6.2 Escalation matrix

| Issue | First contact | Escalation |
|---|---|---|
| RPC connectivity | Check `docs/DEPLOYMENT.md` for known RPC URLs | GitHub issue |
| Registration / stake tx failure | `node dist/index.js status` to diagnose | Discord or GitHub |
| Resolver crashes on start | Check logs; try Docker build | GitHub issue with full logs |
| Suspected slash or misbehaviour | Contact `resolver@oversync.app` immediately | Direct to core team |
| Coordinator not routing orders | Confirm registration at `/api/resolvers/active` | GitHub issue |

---

## 7. Public Evidence Format for a Successful Resolver Trial

When a resolver completes the dry-run, the following evidence is
collected and made public (the core team publishes this; the resolver
operator only needs to provide the swap IDs).

### 7.1 Evidence checklist

| Item | Format | Source |
|---|---|---|
| **Testnet resolver address** | Ethereum address + Stellar public key | Operator provides |
| **Registration transaction hash** | Stellar testnet tx hash | From `node dist/index.js register` output |
| **ETH → XLM fill** | Swap order ID + Etherscan link + Stellar Expert link | Coordinator / explorer |
| **XLM → ETH fill** | Swap order ID + Etherscan link + Stellar Expert link | Coordinator / explorer |
| **Uptime log excerpt** | 7-day uptime ≥ 99% (ping test or coordinator heartbeats) | Coordinator metrics |
| **Stake snapshot** | Screenshot or RPC call showing active stake ≥ `minStake` | `node dist/index.js status` output |
| **CLI version string** | `node dist/index.js --version` output | Operator provides |

### 7.2 Publication template

After a resolver passes the dry-run, the core team publishes an entry
in the project README or a dedicated `RESOLVER_DIRECTORY.md`:

```markdown
## Community Resolver: <Operator Name>

| Field | Value |
|---|---|
| EVM address | `0x...` |
| Stellar address | `G...` |
| Registration tx | `https://stellar.expert/explorer/testnet/tx/<hash>` |
| ETH→XLM demo | `https://sepolia.etherscan.io/tx/<hash>` |
| XLM→ETH demo | `https://stellar.expert/explorer/testnet/tx/<hash>` |
| Uptime (7d) | 99.2% |
| Status | ✅ Onboarded — filling orders |
```

---

## 8. SCF Tranche Reporting Evidence

To count a resolver as **onboarded** for SCF Tranche 2 reporting, the
following must be verifiable by an external reviewer:

### 8.1 Hard requirements

1. **On-chain registration.** The resolver's Stellar address is
   registered in the `ResolverRegistry` with stake ≥ `minStake`.
   Verifiable at:
   ```
   soroban invoke \
     --id CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF \
     --rpc-url https://soroban-testnet.stellar.org \
     --fn isActive \
     --arg G...<resolver_address>
   ```
2. **At least one successful fill in each direction.** A reviewer can
   trace the swap through the coordinator API or block explorers.
3. **7-day observation window.** The resolver must be registered and
   running for at least 7 consecutive days with ≥ 99% uptime measured
   by coordinator heartbeats.

### 8.2 Reporting artefact

For each onboarded resolver, the core team produces a single JSON
document stored in `docs/resolvers/`:

```json
{
  "resolver": {
    "operator": "Operator Name",
    "evmAddress": "0x...",
    "stellarAddress": "G..."
  },
  "registration": {
    "txHash": "...",
    "stake": "1000000000",
    "block": 123456
  },
  "dryRuns": [
    {
      "direction": "ETH->XLM",
      "orderId": "...",
      "fillTxEvm": "https://sepolia.etherscan.io/tx/...",
      "fillTxStellar": "https://stellar.expert/explorer/testnet/tx/..."
    },
    {
      "direction": "XLM->ETH",
      "orderId": "...",
      "fillTxEvm": "https://sepolia.etherscan.io/tx/...",
      "fillTxStellar": "https://stellar.expert/explorer/testnet/tx/..."
    }
  ],
  "observationWindow": {
    "start": "2026-06-01T00:00:00Z",
    "end": "2026-06-08T00:00:00Z",
    "uptime": 0.992
  },
  "status": "onboarded"
}
```

---

## 9. Outreach Template for Resolver Operators

Use this template when contacting prospective resolver operators.

---

**Subject:** OverSync open resolver network — testnet onboarding

**Body:**

Hi <Name>,

OverSync is a non-custodial Ethereum ↔ Stellar bridge built on
symmetric HTLCs — no validator set, no attester, no admin escape hatch.
The bridge is live on testnet (Sepolia + Stellar testnet) and we are
onboarding the first three community resolvers under an SCF-funded
grant programme.

**Why you?**

Your team already runs <Fusion+ resolver infra / Stellar infra / MEV
infra>. Adding OverSync is a marginal operational cost and gives you
early access to a new cross-chain flow with a growing user base.

**What we provide:**

- Reference resolver runner (TypeScript, Docker image)
- Testnet deployment with live contracts and coordinator
- Dedicated onboarding support (Discord + GitHub)
- Grant of $3,000 per resolver (capped at three resolvers)

**What you provide:**

- Infrastructure (2 vCPU, 4 GB RAM — can colocate with existing infra)
- Minimum stake (100 XLM testnet tokens — no real monetary cost)
- 7-day testnet dry-run commitment

**Timeline:**

1. Week 1 — environment setup + registration
2. Week 2 — dry-run fills + observation window
3. Week 3 — onboarding complete; published as community resolver

**Next step:**

Reply to this email or reach us on Discord (`#oversync` on the Stellar
Dev server) and we will send you the full onboarding packet.

---

## 10. Quick-Reference Card

```text
┌─────────────────────────────────────────────────────────────┐
│  OVERYNC RESOLVER ONBOARDING — QUICK REFERENCE              │
├─────────────────────────────────────────────────────────────┤
│ git clone https://github.com/karagozemin/OverSync.git       │
│ cp env.example .env              # fill in your keys/RPCs   │
│ cd resolver && pnpm install && pnpm build                   │
│ node dist/index.js status        # check balances           │
│ node dist/index.js register      # stake 100 XLM           │
│ node dist/index.js run           # start resolving         │
│                                                             │
│ Contract addresses (testnet):                               │
│  EVM HTLCEscrow:       0xb352339BEb...988bB178             │
│  EVM ResolverRegistry: 0x7D9ce70Aa4...1B6D1D99             │
│  Soroban HTLC:         CDIKSJKVMXK...2CTA6JK               │
│  Soroban Registry:     CBSR7Z4MHLP...TIZ4WGF               │
│                                                             │
│ Support: GitHub Issues / Stellar Dev Discord #oversync     │
│ Email: resolver@oversync.app                                │
└─────────────────────────────────────────────────────────────┘
```

---

## References

- [`docs/RESOLVERS.md`](RESOLVERS.md) — running guide
- [`docs/TRUST_MODEL.md`](TRUST_MODEL.md) — security analysis
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — full deploy instructions
- [`deployments.testnet.json`](../deployments.testnet.json) — live
  contract addresses
- [`resolver/`](../resolver/) — source code
- [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md) — SCF review response
  (budget context)
