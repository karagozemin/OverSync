# SCF Tranche Acceptance Checklist

This document maps OverSync's deliverables and budget to specific acceptance criteria for the Stellar Community Fund (SCF). It provides verifiable artifacts for each tranche to facilitate reviewer acceptance.

For higher-level milestones and reviewer feedback context, please refer to our [ROADMAP](../ROADMAP.md) and [Review Response](./REVIEW_RESPONSE.md).

---

## Tranche 1: Audit-prep and hardening deliverables

### 1. Smart Contract Hardening (Soroban)
- **Deliverable**: Refactored Soroban HTLC contracts addressing edge-case security risks (e.g., hash collisions, timeout overrides).
- **Owner/Type of Work**: Core Engineering / Smart Contracts
- **Repo Artifact or URL**: `contracts/soroban/src/htlc.rs`
- **Acceptance Test**: Run `pnpm --filter stellar test` confirming all edge-case unit tests pass.
- **Why it benefits Stellar/Soroban specifically**: Ensures institutional-grade security for assets bridged to the Stellar network, increasing trust in Soroban's DeFi ecosystem.
- **Acceptance Criteria**: 100% test coverage on HTLC lock/unlock/refund methods; zero high-severity issues found in static analysis.

### 2. Integration of Stellar SDK v1.x
- **Deliverable**: Upgrade the relayer and frontend to use the latest Stellar SDK for robust network interaction.
- **Owner/Type of Work**: Frontend & Relayer Teams / Integration
- **Repo Artifact or URL**: `package.json` and `relayer/src/stellar-client.ts`
- **Acceptance Test**: Verify `pnpm -r build` succeeds without Stellar SDK deprecation warnings.
- **Why it benefits Stellar/Soroban specifically**: Takes advantage of the newest Soroban RPC features, promoting adoption of the latest Stellar standards.
- **Acceptance Criteria**: `stellar-sdk` bumped to latest version; API calls migrated from deprecated endpoints.

### 3. Local Stellar Testnet Environment Setup
- **Deliverable**: Dockerized local Soroban testnet environment with automated contract deployment scripts.
- **Owner/Type of Work**: DevOps / Infrastructure
- **Repo Artifact or URL**: `e2e/docker-compose.yml` and `e2e/scripts/setup-local-network.sh`
- **Acceptance Test**: Run `./e2e/scripts/setup-local-network.sh` and verify containers start successfully.
- **Why it benefits Stellar/Soroban specifically**: Lowers the barrier to entry for external developers and auditors to interact with our Soroban contracts locally.
- **Acceptance Criteria**: Script executes without errors; Soroban RPC is reachable locally; contracts are deployed with printed addresses.

### 4. CI/CD Pipeline for Soroban Contracts
- **Deliverable**: Automated GitHub Actions workflow for building and testing Soroban contracts on every PR.
- **Owner/Type of Work**: DevOps / Tooling
- **Repo Artifact or URL**: `.github/workflows/soroban-ci.yml`
- **Acceptance Test**: Open a test PR and verify the "Soroban Build & Test" action completes successfully.
- **Why it benefits Stellar/Soroban specifically**: Ensures consistent code quality and reliability for our Stellar-integrated components before merging.
- **Acceptance Criteria**: Pipeline runs `stellar contract build` and `stellar contract test`; failure blocks PR merges.

### 5. Preliminary Security Audit Prep Document
- **Deliverable**: Comprehensive architecture and security model documentation for the Stellar implementation.
- **Owner/Type of Work**: Core Engineering / Documentation
- **Repo Artifact or URL**: `docs/SECURITY.md`
- **Acceptance Test**: Reviewer validates the document comprehensively covers trust assumptions and threat vectors.
- **Why it benefits Stellar/Soroban specifically**: Provides a clear model for security researchers to analyze Soroban cross-chain interactions.
- **Acceptance Criteria**: Document details trust boundaries, admin keys, and potential failure modes in the Soroban context.

---

## Tranche 2: Testnet reliability, resolver onboarding, metrics, and community validation

### 1. Robust Testnet Relayer Implementation
- **Deliverable**: Relayer service fully operational on Stellar Testnet, handling cross-chain events reliably.
- **Owner/Type of Work**: Backend Engineering / Relayer
- **Repo Artifact or URL**: `relayer/src/index.ts` and `deployments.testnet.json`
- **Acceptance Test**: Initiate a cross-chain swap on testnet and verify the relayer picks up the event and executes it on Soroban.
- **Why it benefits Stellar/Soroban specifically**: Demonstrates the viability of automated cross-chain liquidity flow into the Stellar ecosystem.
- **Acceptance Criteria**: Relayer maintains >99% uptime on testnet over a 7-day period; handles RPC rate limits gracefully.

### 2. Resolver Onboarding SDK
- **Deliverable**: SDK/toolkit enabling third-party liquidity providers (resolvers) to connect and execute intents on Stellar.
- **Owner/Type of Work**: Developer Relations / SDK
- **Repo Artifact or URL**: `packages/resolver-sdk/`
- **Acceptance Test**: Run `pnpm --filter @oversync/resolver-sdk test` and view the README examples.
- **Why it benefits Stellar/Soroban specifically**: Brings external liquidity providers to Stellar, boosting total value locked and market efficiency.
- **Acceptance Criteria**: SDK successfully connects to Stellar Testnet; documentation includes step-by-step onboarding guide.

### 3. Comprehensive System Metrics Dashboard
- **Deliverable**: Grafana/Prometheus integration tracking Soroban contract interactions and relayer health.
- **Owner/Type of Work**: DevOps / Observability
- **Repo Artifact or URL**: `coordinator/src/metrics.ts`
- **Acceptance Test**: Navigate to `/health` and `/metrics` endpoints and verify data is exported.
- **Why it benefits Stellar/Soroban specifically**: Provides transparency into the volume of transactions driven to the Stellar network.
- **Acceptance Criteria**: Metrics include transaction success rate, average latency on Soroban, and error classifications.

### 4. Community Bug Bounty Launch (Testnet)
- **Deliverable**: Public announcement and guidelines for a bug bounty focusing on the Soroban contracts.
- **Owner/Type of Work**: Community Management / Security
- **Repo Artifact or URL**: `docs/TRUST_MODEL.md` and public forum post.
- **Acceptance Test**: Verify the published guidelines explicitly outline scope for Stellar smart contracts.
- **Why it benefits Stellar/Soroban specifically**: Engages the broader Stellar developer community in securing the platform.
- **Acceptance Criteria**: Clear reward tiers established; scope defined; minimum 3 community participants engaged.

### 5. Automated E2E Test Suite on Testnet
- **Deliverable**: End-to-end tests executing real cross-chain transactions between testnets (including Stellar Testnet).
- **Owner/Type of Work**: QA / Testing
- **Repo Artifact or URL**: `e2e/testnet.spec.ts`
- **Acceptance Test**: Run `pnpm test:e2e` and verify successful execution against live testnets.
- **Why it benefits Stellar/Soroban specifically**: Proves the integration works in a realistic, non-local environment.
- **Acceptance Criteria**: E2E suite passes 10 consecutive times without flakiness; covers successful swaps and refund scenarios.

---

## Tranche 3: Mainnet-readiness gates, audit reports, and launch criteria

### 1. Final Security Audit Report for Soroban Contracts
- **Deliverable**: Published security audit from a reputable firm covering all Stellar/Soroban code.
- **Owner/Type of Work**: External Auditors / Core Engineering
- **Repo Artifact or URL**: `docs/audits/soroban_final_audit.pdf`
- **Acceptance Test**: Review the PDF for any unresolved high or critical vulnerabilities.
- **Why it benefits Stellar/Soroban specifically**: Gives users confidence to bring large amounts of liquidity to the Stellar network.
- **Acceptance Criteria**: All critical and high issues mitigated or resolved; report is publicly accessible.

### 2. Mainnet Deployment Scripts & Verification
- **Deliverable**: Scripts and procedural documentation for deploying the OverSync system to Stellar Mainnet safely.
- **Owner/Type of Work**: DevOps / Core Engineering
- **Repo Artifact or URL**: `docs/DEPLOYMENT.md` and `contracts/scripts/deploy-mainnet.sh`
- **Acceptance Test**: Verify `deploy-mainnet.sh` contains necessary multi-sig or timelock safeguards.
- **Why it benefits Stellar/Soroban specifically**: Ensures a professional and secure launch on the Stellar public network.
- **Acceptance Criteria**: Deployment process requires multi-sig approval; contract hashes match audited versions.

### 3. Mainnet Launch of Frontend and Relayer
- **Deliverable**: Production-ready UI and relayer infrastructure pointed to Stellar Mainnet.
- **Owner/Type of Work**: Frontend & Backend Engineering / Product
- **Repo Artifact or URL**: `vercel.json` and production URLs.
- **Acceptance Test**: Visit the production web app and successfully connect a Stellar wallet (e.g., Freighter).
- **Why it benefits Stellar/Soroban specifically**: Makes the cross-chain bridge accessible to end-users on Stellar.
- **Acceptance Criteria**: Production environment deployed; SSL secured; connects to Stellar Mainnet RPC.

### 4. Integration with Stellar Ecosystem Wallets
- **Deliverable**: Verified support for leading Stellar wallets (Freighter, Albedo, xBull) in the frontend.
- **Owner/Type of Work**: Frontend Engineering / UX
- **Repo Artifact or URL**: `frontend/src/components/WalletModal.tsx`
- **Acceptance Test**: Connect and sign a test transaction using Freighter and at least one other Stellar wallet.
- **Why it benefits Stellar/Soroban specifically**: Maximizes user accessibility for existing Stellar ecosystem participants.
- **Acceptance Criteria**: Users can connect, switch networks, and sign transactions with at least three different Stellar wallets.

### 5. On-Chain Liquidity Bootstrapping
- **Deliverable**: Initial liquidity provided by early resolvers on Stellar Mainnet to enable immediate usage.
- **Owner/Type of Work**: Business Development / Operations
- **Repo Artifact or URL**: Stellar Mainnet transaction hash confirming liquidity deposit.
- **Acceptance Test**: Verify the mainnet contract holds the required initial liquidity balance on Stellar.
- **Why it benefits Stellar/Soroban specifically**: Ensures the bridge is functional from day one, driving immediate volume to Stellar.
- **Acceptance Criteria**: Minimum target liquidity (e.g., $50k equivalent) successfully deposited into the Soroban HTLC pool.
