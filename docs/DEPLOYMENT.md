# Deployment

Step-by-step instructions for deploying OverSync v2 to testnet or
mainnet. Replaces the previous `MAINNET_SETUP.md` /
`MAINNET_SETUP_UPDATED.md` / `RATE_LIMIT_FIX.md` documents, which
contained inconsistencies flagged in v1 review feedback.

## Prerequisites

- Node.js 22.5+ (required for built-in `node:sqlite`)
- pnpm 9+
- Rust stable + `wasm32-unknown-unknown` target
- Stellar CLI 22.x (`cargo install --locked stellar-cli`)
- A funded Ethereum deployer key (Sepolia or mainnet)
- A funded Stellar account (Soroban testnet or public)

## Environment Validation

All OverSync services now perform **strict environment validation at startup**:

- **Coordinator**: Validates config with Zod schema, requires testnet contract addresses, blocks mainnet without audit confirmation
- **Resolver**: Validates config with Zod schema, requires testnet contract addresses, blocks mainnet without audit confirmation  
- **Relayer**: Validates RPC URLs, contract addresses, private keys, and timeout settings
- **Frontend**: Validates contract addresses and network configuration at **build time** (Vite)

**Services will fail to start if required environment variables are missing or malformed.**

## 1. Copy and fill in the env file

```bash
cp env.example .env
$EDITOR .env
```

At minimum, set:

```
NETWORK_MODE=testnet
INFURA_API_KEY=<your_infura_project_key>
# or: SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<key>
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ETHERSCAN_API_KEY=<key>
```

**⚠️  CRITICAL: Do NOT set `MAINNET_AUDIT_CONFIRMED=true` until you have completed the mainnet readiness checklist below.**

Testnet asset identifier mappings (native ETH ↔ XLM, Sepolia USDC ↔ Stellar USDC)
are centralized in `packages/sdk/src/assets/index.ts` and exported from
`@oversync/sdk`.

Backend services resolve the EVM RPC in this order: explicit
`SEPOLIA_RPC_URL` / `MAINNET_RPC_URL`, then `INFURA_API_KEY`, then a
public fallback. Production (DigitalOcean) should use Infura — keep the
polling optimisations deployed so the free tier is not exhausted by
background listeners.

You will fill in the deployed contract addresses later.

## 2. Deploy the Soroban contracts

```bash
cd soroban
stellar keys generate --global --network testnet deployer
stellar keys fund deployer --network testnet
./scripts/deploy.sh testnet deployer
```

This:

1. Builds both WASM artefacts (`oversync_htlc.wasm` and
   `oversync_resolver_registry.wasm`).
2. Deploys + initialises them on the chosen network.
3. Links the HTLC to the registry via `set_resolver_registry`.
4. Writes contract ids to `deployments.<network>.json`.

Copy the contract ids into `.env`:

```
SOROBAN_HTLC_TESTNET=C...
SOROBAN_RESOLVER_REGISTRY_TESTNET=C...
```

## 3. Deploy the Ethereum contracts

The deploy script requires a stake asset (an ERC20 used for resolver
staking). On testnet you can use any test ERC20; on mainnet pick a
stable token such as USDC.

```bash
cd contracts
V2_STAKE_ASSET=0x...                  # ERC20 address
V2_MIN_STAKE=100000000000000000000    # 100 tokens (assuming 18 dp)
V2_MIN_SAFETY_DEPOSIT=0
RELAYER_PRIVATE_KEY=0x...

pnpm exec hardhat run scripts/v2/deploy.ts --network sepolia
```

This deploys `ResolverRegistry` and `HTLCEscrow` and appends the
addresses to `deployments.sepolia.json`. Copy them into `.env`:

```
ETH_HTLC_ESCROW_TESTNET=0x...
ETH_RESOLVER_REGISTRY_TESTNET=0x...
```

## 4. Start the coordinator

```bash
cd coordinator
pnpm install
pnpm build
pnpm start
```

By default the coordinator listens on `:3001` and writes its cache to
`./oversync.db`. For production swap to a Postgres connection string
via `DATABASE_URL`.

## 5. (Optional) Start a resolver

See [`RESOLVERS.md`](RESOLVERS.md). The short version:

```bash
cd resolver
pnpm install
pnpm build
node dist/index.js register   # stake into the registry
node dist/index.js run        # listen + react to events
```

## 6. Deploy the frontend

```bash
cd frontend
pnpm install
# .env.local should have VITE_ETH_HTLC_ESCROW_TESTNET, VITE_API_BASE_URL, etc.
pnpm build
# Serve dist/ via any static host (Vercel, Cloudflare Pages, Netlify).
```

### Frontend network mode

By default the public UI is **testnet-only**:

```
VITE_NETWORK=testnet
VITE_MAINNET_ENABLED=false
```

When `VITE_MAINNET_ENABLED` is unset or `false`:

- The navbar shows **Testnet** (active) and a disabled **Mainnet Coming** control.
- `?network=mainnet` in the URL is rewritten to `testnet`.
- All bridge, history, and refund flows use Sepolia + Stellar testnet (v2).

Set `VITE_MAINNET_ENABLED=true` only when deliberately re-enabling
mainnet after v2 audit and mainnet contract deployment. Until then,
keep it `false` on Vercel / production hosts.

## Verifying contracts on Etherscan

```bash
cd contracts
pnpm exec hardhat verify --network sepolia <ESCROW_ADDRESS> <REGISTRY_ADDRESS> <MIN_SAFETY_DEPOSIT>
pnpm exec hardhat verify --network sepolia <REGISTRY_ADDRESS> <STAKE_ASSET> <MIN_STAKE> <SLASH_BENEFICIARY> <OWNER>
```

## Mainnet rollout checklist

Before setting `VITE_MAINNET_ENABLED=true` and flipping backend
`NETWORK_MODE=mainnet`:

- [ ] Both HTLC contracts independently audited (see [`SECURITY.md`](SECURITY.md))
- [ ] `ResolverRegistry.owner` transferred to a 2/3 multisig
- [ ] At least 3 community resolvers registered
- [ ] Coordinator behind a CDN / WAF
- [ ] Public bug bounty announced
- [ ] Sepolia run with $1k+ in TVL for a continuous 14-day window without incidents

**Once all items are checked:**

1. Set `MAINNET_AUDIT_CONFIRMED=true` in backend `.env` (coordinator, resolver, relayer)
2. Set `VITE_MAINNET_AUDIT_CONFIRMED=true` in Vercel environment variables
3. Set `VITE_MAINNET_ENABLED=true` in Vercel environment variables
4. Flip backend `NETWORK_MODE=mainnet` and deploy

**This three-step process prevents accidental mainnet enablement.**

## Rolling back

If a serious bug is found post-launch, the HTLCEscrow contract has
**no kill switch** by design — this is a feature, not a missing
mitigation. The recovery path is:

1. Stop the coordinator so new orders are not created.
2. Let in-flight orders settle via claim or refund within their
   existing timelocks.
3. Migrate users to a new HTLCEscrow + ResolverRegistry deployment.

This is the same recovery model as 1inch Fusion+ and other HTLC bridges.

## Updating addresses after redeployment

After a new testnet or mainnet deploy, update these files in one commit so
the CI address-consistency check stays green:

1. **`deployments.testnet.json`** (or `deployments.mainnet.json`): the deploy
   script writes the new addresses here automatically. Verify before committing.

2. **`README.md`**: update the "Smart contracts" table — both the display
   abbreviation (`0xABCD…1234`) and the full address in the Etherscan/Stellar
   Expert hyperlink.

3. **`ROADMAP.md`**: update the "Current production status" table row for the
   affected environment.

4. **`.env` / Vercel / DigitalOcean**: set the backend env vars that the
   coordinator and resolver read:
   ```
   ETH_HTLC_ESCROW_TESTNET=0x<new>
   ETH_RESOLVER_REGISTRY_TESTNET=0x<new>
   SOROBAN_HTLC_TESTNET=C<new>
   SOROBAN_RESOLVER_REGISTRY_TESTNET=C<new>
   ```
   And the frontend Vercel env vars:
   ```
   VITE_ETH_HTLC_ESCROW_TESTNET=0x<new>
   VITE_ETH_RESOLVER_REGISTRY_TESTNET=0x<new>
   VITE_SOROBAN_HTLC_TESTNET=C<new>
   VITE_SOROBAN_RESOLVER_REGISTRY_TESTNET=C<new>
   ```

5. **Verify**: run `pnpm verify:addresses` locally before pushing. The same
   check runs in CI (`address-verify` workflow) on every PR that touches these
   files and will block the merge if any value drifts.

## Environment Variable Reference

See [`env.example`](../env.example) for a complete list of all environment variables
with descriptions. Key variables by service:

### Coordinator (`coordinator/src/config.ts`)
- `NETWORK_MODE`, `MAINNET_AUDIT_CONFIRMED` (mainnet only)
- `ETH_HTLC_ESCROW_TESTNET` / `ETH_HTLC_ESCROW_MAINNET`
- `ETH_RESOLVER_REGISTRY_TESTNET` / `ETH_RESOLVER_REGISTRY_MAINNET`
- `SOROBAN_HTLC_TESTNET` / `SOROBAN_HTLC_MAINNET`
- `SOROBAN_RESOLVER_REGISTRY_TESTNET` / `SOROBAN_RESOLVER_REGISTRY_MAINNET`
- `DATABASE_URL`, `COORDINATOR_PORT`, `LOG_LEVEL`

### Resolver (`resolver/src/config.ts`)
- Same contract address variables as coordinator
- `RESOLVER_ETH_PRIVATE_KEY`, `RESOLVER_STELLAR_SECRET` (required for production)
- `COORDINATOR_URL`, `RESOLVER_POLL_INTERVAL_MS`

### Relayer (`relayer/src/index.ts`)
- `RELAYER_PRIVATE_KEY`, `RELAYER_STELLAR_SECRET`, `RELAYER_STELLAR_PUBLIC`
- `RELAYER_RPC_TIMEOUT_MS`, `RELAYER_RETRY_ATTEMPTS`
- `ETHEREUM_NETWORK`, `STELLAR_NETWORK`
- `GAS_PRICE_GWEI`, `GAS_LIMIT`

### Frontend (`frontend/src/config/networks.ts`)
- `VITE_NETWORK_MODE`, `VITE_MAINNET_ENABLED`, `VITE_MAINNET_AUDIT_CONFIRMED`
- `VITE_ETH_HTLC_ESCROW_TESTNET` / `VITE_ETH_HTLC_ESCROW_MAINNET`
- `VITE_ETH_RESOLVER_REGISTRY_TESTNET` / `VITE_ETH_RESOLVER_REGISTRY_MAINNET`
- `VITE_SOROBAN_HTLC_TESTNET` / `VITE_SOROBAN_HTLC_MAINNET`
- `VITE_SOROBAN_RESOLVER_REGISTRY_TESTNET` / `VITE_SOROBAN_RESOLVER_REGISTRY_MAINNET`
- `VITE_API_BASE_URL`, `VITE_SEPOLIA_RPC_URL`, `VITE_MAINNET_RPC_URL`

## Troubleshooting

### "MAINNET DEPLOYMENT BLOCKED" error
This is a safety feature. Complete the mainnet readiness checklist in `env.example`
and set `MAINNET_AUDIT_CONFIRMED=true`.

### "TESTNET DEPLOYMENT INCOMPLETE" error
Deploy the testnet contracts first (see Section 2 and 3 above), then set the
contract address environment variables.

### Frontend build fails with "Frontend environment validation failed"
Check that all `VITE_*` contract address variables are set in your Vercel
environment variables. The build will fail if testnet/mainnet contract addresses
are missing when the corresponding network mode is selected.
