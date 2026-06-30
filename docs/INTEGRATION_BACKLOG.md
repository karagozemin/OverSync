# OverSync v2 — Integration Backlog

- **Status:** Living document — update as integrations are completed, deprioritized, or added.
- **Repository:** <https://github.com/oversync/oversync>
- **Last updated:** June 2026

---

## Prioritization rationale

OverSync is a bridge between Ethereum and Stellar. User acquisition depends on having both sides equally accessible. However, Stellar wallets, explorers, and dApps are fewer and less standardized than their EVM counterparts. Every Stellar-side integration has an outsized impact on the user experience because it removes the main friction point for the target audience.

Consequently, **Must-Have Launch Integrations** focus on Stellar-native distribution: the wallets, explorers, and infrastructure that turn a working bridge into a usable product. EVM-side integrations are largely already handled by MetaMask and Etherscan compatibility; the gaps are on Stellar.

Post-mainnet integration expands outward: multi-chain adapters (Axelar, CCTP), analytics, and developer tooling that grow the addressable market beyond the initial Stellar + ETH corridor.

---

## Must-Have Launch Integrations

### 1. Freighter (Stellar wallet — production hardening)

| Field | Detail |
|---|---|
| **User benefit** | Freighter is the dominant Stellar browser wallet. Users need it to sign Soroban transactions (create_order, claim_order). Already integrated as `FreighterSorobanSigner` in the SDK. |
| **Required SDK surface** | `FreighterSorobanSigner` — existing. |
| **Effort** | Small |
| **Dependencies** | Freighter API stability across Soroban testnet → mainnet. Audit of SDK signer abstraction. |
| **Completion evidence** | Swap completed end-to-end on testnet using Freighter for both Stellar-side auth and MetaMask for EVM-side. Documented in `docs/SIGNER.md`. |

### 2. MetaMask / Rabby (EVM wallet — production hardening)

| Field | Detail |
|---|---|
| **User benefit** | Required for EVM-side createOrder, claimOrder, refundOrder. Already integrated via `WalletClientEthereumSigner` in the SDK. |
| **Required SDK surface** | `WalletClientEthereumSigner` — existing. Also compatible with Rabby, WalletConnect-injected providers. |
| **Effort** | Small |
| **Dependencies** | None. |
| **Completion evidence** | Testnet swap using MetaMask for EVM-side signing. Documented in `docs/SIGNER.md`. |

### 3. WalletConnect (EVM wallet — broad EVM wallet support)

| Field | Detail |
|---|---|
| **User benefit** | Enables Rainbow, Trust Wallet, Zerion, and dozens of other EVM wallets that use WalletConnect. |
| **Required SDK surface** | `EthereumSignerI` accepts any viem-compatible `WalletClient`. WalletConnect v2 adapter via `@web3modal/wagmi` or `@reown-io/walletkit`. |
| **Effort** | Medium |
| **Dependencies** | SDK signer abstraction reviewed and merged. Frontend WalletConnect integration component. |
| **Completion evidence** | Swap completed end-to-end using a WalletConnect-connected wallet for EVM-side signing. |

### 4. Stellar Expert integration (block explorer)

| Field | Detail |
|---|---|
| **User benefit** | Users need to verify HTLC transactions, preimage reveals, and refunds on Stellar. The frontend should link directly to Stellar Expert pages for every on-chain event. |
| **Required SDK surface** | None (frontend-only). Accept a `stellarExpertTxUrl(orderId, txHash)` helper. |
| **Effort** | Small |
| **Dependencies** | Soroban transaction view support in Stellar Expert (production). Currently works on testnet. |
| **Completion evidence** | Every order event in the frontend history panel links to the correct Stellar Expert page. |

### 5. Etherscan / Sepolia explorer integration (block explorer)

| Field | Detail |
|---|---|
| **User benefit** | Same as above for EVM-side transactions. Already partially handled; formalize link generation in the SDK. |
| **Required SDK surface** | Add `etherscanTxUrl(chainId, txHash)` and `etherscanAddressUrl(chainId, address)` helpers to the SDK. |
| **Effort** | Small |
| **Dependencies** | None. |
| **Completion evidence** | Frontend history panel links every EVM event to the correct Etherscan page (Sepolia testnet; mainnet post-launch). |

### 6. Community resolver onboarding program

| Field | Detail |
|---|---|
| **User benefit** | More resolvers = better liveness guarantees, geographic diversity, and censorship resistance. |
| **Required SDK surface** | Resolver runner at [`resolver/`](../resolver/) — existing. Needs additional documentation: `RESOLVERS.md` exists at [`docs/RESOLVERS.md`](RESOLVERS.md). |
| **Effort** | Medium |
| **Dependencies** | Registry deployed on testnet (done — see [`deployments.testnet.json`](../deployments.testnet.json)). Minimum 3 independent resolver operators before mainnet (per [`ROADMAP.md`](../ROADMAP.md)). |
| **Completion evidence** | Three non-team-operated resolvers registered and successfully completing swaps on testnet. |

### 7. Stellar DEX integration (Stellar-native dApp)

| Field | Detail |
|---|---|
| **User benefit** | Stellar DEX users can swap native XLM for ETH (or ETH-pegged assets) without leaving the DEX interface. Drives volume and demonstrates composability. |
| **Required SDK surface** | The SDK's [`EthereumHTLCClient`](../packages/sdk/src/ethereum/index.ts) and [`SorobanHTLCClient`](../packages/sdk/src/soroban/index.ts) are sufficient. The DEX embeds the swap flow via `@oversync/sdk`. |
| **Effort** | Large |
| **Dependencies** | Active partnership with a Stellar DEX team. SDK published to npm. DEX team integration effort. |
| **Completion evidence** | Cross-chain swap initiated from the partner DEX frontend using `@oversync/sdk`. Coordinated blog post and social announcement. |

### 8. Stellar non-XLM Soroban assets in SDK

| Field | Detail |
|---|---|
| **User benefit** | Users can bridge USDC, EURC, or any Stellar Asset Contract (SAC) token — not just native XLM. Currently SDK asset resolution is limited. |
| **Required SDK surface** | Extend [`resolveStellarAsset`](../packages/sdk/src/assets/index.ts) to accept SAC token addresses and their metadata. Add Stellar-side asset whitelist configuration. |
| **Effort** | Medium |
| **Dependencies** | Soroban token contract metadata (`stellar contract asset info`). Token-liquidity pairs defined. |
| **Completion evidence** | Successful testnet swap of a non-XLM Stellar asset (e.g., Stellar USDC) against Sepolia USDC. |

---

## Post-Mainnet / Nice-to-Have Integrations

### 9. 1inch Fusion+ resolver mesh

| Field | Detail |
|---|---|
| **User benefit** | OverSync resolvers become accessible to 1inch Fusion+ users, tapping into the largest on-chain solver network. |
| **Required SDK surface** | Adhere to Fusion+ resolver API specification (Dutch auction, order settlement, fee model). |
| **Effort** | Large |
| **Dependencies** | 1inch Fusion+ publicly documented resolver API. OverSync's resolver runner already shares mental model with Fusion+ resolvers. Tracked in [`ROADMAP.md`](../ROADMAP.md) (Q2–Q3 2027). |
| **Completion evidence** | Fusion+ order filled by an OverSync resolver with on-chain settlement. |

### 10. Circle CCTP v2 composable fast path

| Field | Detail |
|---|---|
| **User benefit** | USDC swaps on OverSync can use Circle's attestation for fast-path settlement on the destination chain, reducing the asymmetric timelock UX. |
| **Required SDK surface** | New `CCTPAdapter` bridge kind integrating Circle's attestation API. SDK types already have `ExternalBridgeKind::Cctp` at [`packages/sdk/src/types/index.ts`](../packages/sdk/src/types/index.ts). |
| **Effort** | Large |
| **Dependencies** | Circle CCTP v2 deployed on Stellar mainnet (announced 2026). OverSync mainnet launch complete. Tracked in [`ROADMAP.md`](../ROADMAP.md) (Q1 2027, pulled forward). |
| **Completion evidence** | USDC swap settling via CCTP attestation within CCTP's latency window (< 30 minutes). |

### 11. Axelar ITS adapter

| Field | Detail |
|---|---|
| **User benefit** | Users bridging via Axelar ITS can route through OverSync for the Stellar–ETH corridor, gaining HTLC security for the last hop. |
| **Required SDK surface** | New `AxelarITSAdapter` bridge kind. SDK types already have `ExternalBridgeKind::Axelar` at [`packages/sdk/src/types/index.ts`](../packages/sdk/src/types/index.ts). |
| **Effort** | Large |
| **Dependencies** | Axelar ITS live on Stellar mainnet (since Feb 2026). Axelar API docs. OverSync mainnet launch. Tracked in [`ROADMAP.md`](../ROADMAP.md) (Q1 2027). |
| **Completion evidence** | Cross-chain swap that routes through Axelar ITS for origin-chain settlement and OverSync for the Stellar–ETH leg. |

### 12. DeFiLlama adapter

| Field | Detail |
|---|---|
| **User benefit** | TVL transparency. Integrators and liquidity providers use DeFiLlama to assess bridge usage and trust. |
| **Required SDK surface** | None. A standalone script that queries on-chain balances to compute TVL. |
| **Effort** | Small |
| **Dependencies** | DeFiLlama adapter specification. HTLC and registry contracts deployed on mainnet. |
| **Completion evidence** | OverSync appears on DeFiLlama with live TVL and volume data. |

### 13. Dune Analytics dashboard

| Field | Detail |
|---|---|
| **User benefit** | Community can audit bridge activity: order volume, resolver performance, refund rates, failure modes. |
| **Required SDK surface** | None (Dune parses on-chain data). Publish Dune team with decoded event schemas. |
| **Effort** | Small |
| **Dependencies** | Contracts deployed on mainnet. Event ABIs documented (exists in [`ARCHITECTURE.md`](../ARCHITECTURE.md) and interfaces). |
| **Completion evidence** | Public Dune dashboard showing swap volume, unique users, resolver distribution, refund rate, and TVL. |

### 14. The Graph subgraph (EVMs)

| Field | Detail |
|---|---|
| **User benefit** | Decentralized indexing of EVM-side HTLC events. Coordinator could fall back to the subgraph instead of polling `eth_getLogs`. |
| **Required SDK surface** | None. New `subgraph/` package with schema.yaml, mappings, and a `subgraph.yaml` manifest. |
| **Effort** | Medium |
| **Dependencies** | The Graph hosted service or decentralized network. Contracts deployed on mainnet (immutable addresses needed). |
| **Completion evidence** | Subgraph synced from deployment block; queries return correct order, claim, and refund events. |

### 15. Soroban block explorer (Stellar-native explorer)

| Field | Detail |
|---|---|
| **User benefit** | Stellar users often prefer Stellar-specific explorers (StellarExpert, StellarChain). Full Soroban event decoding in at least one explorer. |
| **Required SDK surface** | Provide event schema documentation to explorer teams. |
| **Effort** | Small |
| **Dependencies** | Explorer teams add Soroban custom event decoding. StellarExpert already supports basic Soroban view. |
| **Completion evidence** | StellarExpert or equivalent displays decoded `OrderCreated` / `OrderClaimed` / `OrderRefunded` events for OverSync contracts. |

### 16. Ledger / hardware wallet support (Stellar side)

| Field | Detail |
|---|---|
| **User benefit** | High-value users need hardware-backed signing for Soroban transactions. Freighter does not support Ledger for Soroban as of mid-2026. |
| **Required SDK surface** | Extend `SorobanSignerI` with a `LedgerSorobanSigner` that communicates with the Stellar Ledger app via `@stellar/strkey` or Stellar Ledger API. |
| **Effort** | Large |
| **Dependencies** | Stellar Ledger app supports Soroban transaction signing. Ledger Stellar app update cycle. |
| **Completion evidence** | Swap signed with Ledger device on Stellar side, documented in `docs/SIGNER.md`. |

### 17. Payment application integration (Stellar-based wallet with swap)

| Field | Detail |
|---|---|
| **User benefit** | Stellar payment apps (e.g., Vibrant, Lobstr, xBull) embed cross-chain swap as a native feature. Users swap XLM to ETH without leaving their wallet. |
| **Required SDK surface** | Published `@oversync/sdk` npm package. Wallet team integrates `SorobanHTLCClient` + `EthereumHTLCClient`. |
| **Effort** | Large |
| **Dependencies** | Active partnership with wallet team. SDK published and stable. Wallet team engineering bandwidth. |
| **Completion evidence** | Swap initiated from the partner wallet UI. Coordinated public launch. |

### 18. Prometheus / Grafana public status dashboard

| Field | Detail |
|---|---|
| **User benefit** | Users and integrators can check bridge health, resolver count, and recent latency without running their own monitoring. |
| **Required SDK surface** | None. The coordinator already exports Prometheus metrics (see [`coordinator/ops/README.md`](../coordinator/ops/README.md)). |
| **Effort** | Small |
| **Dependencies** | Coordinator deployed to production. Grafana Cloud or self-hosted instance. |
| **Completion evidence** | Public status page at e.g., `status.oversync.app` showing live metrics from the coordinator. |

### 19. Developer quick-start tutorial (SDK + local testnet)

| Field | Detail |
|---|---|
| **User benefit** | Lower barrier for integrators. A step-by-step guide to setting up a local dev environment and executing a swap via the SDK. |
| **Required SDK surface** | None. Documentation improvement. |
| **Effort** | Small |
| **Dependencies** | None. |
| **Completion evidence** | A new `docs/QUICKSTART.md` or expanded `README.md` section with a runnable example. |

### 20. Programmatic order API for integrators (coordinator API)

| Field | Detail |
|---|---|
| **User benefit** | Automated market makers, OTC desks, and treasury managers can programmatically create and monitor orders without a browser. |
| **Required SDK surface** | The coordinator's REST API at [`coordinator/`](../coordinator/) already serves `/orders` and `/secrets`. Formalize API documentation and authentication (optional API keys for rate-limit tier). |
| **Effort** | Medium |
| **Dependencies** | Coordinator deployed to production. API key system if rate limits are needed. |
| **Completion evidence** | Published OpenAPI spec. Automated integration test creates and monitors an order via API. |

---

## Completed integrations

| Integration | Status | Evidence |
|---|---|---|
| Freighter (Soroban signing) | Done | `FreighterSorobanSigner`, tested. |
| MetaMask (EVM signing) | Done | `WalletClientEthereumSigner`, tested. |
| Keypair (Soroban backend signing) | Done | `KeypairSorobanSigner`, tested. |
| Private key (EVM backend signing) | Done | `PrivateKeyEthereumSigner`, tested. |
| Resolver runner (Docker) | Done | [`resolver/`](../resolver/), [`resolver/Dockerfile`](../resolver/Dockerfile). |
| Coordinator Prometheus metrics | Done | [`coordinator/ops/README.md`](../coordinator/ops/README.md). |
| Testnet contract deployments | Done | [`deployments.testnet.json`](../deployments.testnet.json). |

---

## References

- [`ROADMAP.md`](../ROADMAP.md) — Delivery roadmap with milestone timeline (Q2 2026 – Q3 2027).
- [`docs/TRACTION.md`](TRACTION.md) — GTM plan, target user segments, partnership pipeline, KPIs.
- [`docs/DIFFERENTIATION.md`](DIFFERENTIATION.md) — Competitive landscape vs CCTP, Axelar ITS, Allbridge.
- [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) — Deployment guide for testnet/mainnet.
- [`docs/RESOLVERS.md`](RESOLVERS.md) — Community resolver operator guide.
- `docs/SIGNER.md` — SDK signer abstraction and custom signer guide.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — Full system architecture, refund layers, security boundaries.
- [`packages/sdk/`](../packages/sdk/) — `@oversync/sdk` source, types, and clients.
- [`coordinator/README.md`](../coordinator/README.md) — Coordinator service documentation.
- [`coordinator/ops/README.md`](../coordinator/ops/README.md) — Observability stack (Prometheus + Grafana).
- `docs/AUDIT_PROCUREMENT.md` — Audit scope and security invariants.
- [`docs/SECURITY.md`](SECURITY.md) — Threat model, audit status, bug bounty plan.
- [`deployments.testnet.json`](../deployments.testnet.json) — Current testnet contract addresses.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — Developer setup and contribution process.
