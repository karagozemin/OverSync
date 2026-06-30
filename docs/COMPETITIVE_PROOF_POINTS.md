# Competitive Proof-Point Appendix

> **Purpose.** This appendix supplies sourced evidence for the claims in
> [`DIFFERENTIATION.md`](./DIFFERENTIATION.md). It is intended for SCF
> reviewers and investors who will challenge those claims directly. Every
> external fact below carries a source link and an access date. Claims that
> go beyond the source are labelled **[INFERENCE]** or **[OVERSYNC POSITION]**
> so readers can distinguish what the sources prove from what we argue.
>
> **What this document does not do.** It does not introduce unsupported
> market-size or TVL claims. Numbers cited are lifted verbatim from the
> linked sources. Figures that could change quickly (TVL, chain count) carry
> the date they were retrieved.

---

## 1. Quick-reference decision table

Use this when a reviewer asks "when should I use which bridge?"

| Scenario | Recommended tool | Reason |
|---|---|---|
| Move USDC between Ethereum and Stellar (or any of 23 CCTP chains) | **CCTP v2** | Native burn-and-mint; no wrapped tokens; no third-party custodian; first-party Circle support |
| Bridge a non-USDC token to/from Stellar where wrapping is acceptable | **Axelar ITS** | 70+ chains; institutional partners (Squid, Solv, Stronghold); validator-set security |
| Move stablecoins to/from Stellar with an existing on-ramp integration | **Allbridge Core** | Established liquidity pools; auto-handles Stellar account activation and trustlines |
| Swap **native XLM ↔ ETH** or arbitrary ERC-20 with **no validator committee** in the path | **OverSync** | HTLC math guarantees: user funds are either claimed with the correct preimage or refunded permissionlessly when the timelock expires — no privileged signer can redirect them |
| USDC ↔ native XLM in a single user action | **OverSync + CCTP v2 fast path** (Q1 2027 roadmap) | USDC leg routed via CCTP; native-asset leg via OverSync HTLC; one combined SDK call |

---

## 2. CCTP v2 — scope and attestation-service trust model

### 2a. What the sources say

**FACT.** Circle's Cross-Chain Transfer Protocol v2 went live on Stellar mainnet
in May 2026, connecting Stellar to 23 other CCTP-supported chains including
Ethereum, Solana, Base, and Arbitrum. The protocol burns USDC on the source
chain, has Circle's off-chain Iris attestation service sign the burn proof, and
mints native USDC on the destination chain — no wrapped token is created.
> Source: Stellar Development Foundation, *"Circle CCTP is Live on Stellar"*,
> stellar.org/blog/foundation-news/circle-cctp-is-live-on-stellar, May 19, 2026.
> Accessed June 28, 2026.

**FACT.** CCTP v2 is USDC-only. The protocol spec explicitly states it
transfers USDC; the burn-and-mint mechanic presupposes Circle's mint authority
over the asset. No other token can be transferred through CCTP.
> Source: Circle, *"CCTP (Cross-Chain Transfer Protocol)"* product page,
> circle.com/cross-chain-transfer-protocol. Accessed June 28, 2026.

**FACT.** Circle's Iris attestation service is the trust boundary. Circle
controls a multisig that signs attestations; compromise of that key would
allow minting USDC on a destination chain without a corresponding source-chain
burn. Circle mitigates this with hardware-backed key custody and an emergency
pause role.
> Source: eco.com support article, *"Circle CCTP V2: Native USDC Across 13+
> Chains"*, eco.com/support/en/articles/11813797-circle-cctp-v2-native-usdc-across-13-chains,
> May 28, 2026. Accessed June 28, 2026.

**FACT.** As of November 2025, CCTP (both versions combined) had processed over
$110 billion in cumulative volume and more than 5.3 million total cross-chain
transfers.
> Source: Circle, *"CCTP V1 deprecation: CCTP V2 is now the canonical CCTP"*,
> circle.com/blog/cctp-version-updates, November 14, 2025. Accessed June 28, 2026.

### 2b. What this means for OverSync

**[OVERSYNC POSITION]** CCTP v2 and OverSync occupy different product spaces
and are complementary rather than competing:

- CCTP v2 moves USDC between any two of its 23 supported chains, extremely
  efficiently, with Circle's track record and first-party support. OverSync
  moves **native XLM ↔ ETH** (or arbitrary ERC-20s) with no first-party
  attester in the path.
- A user landing on Stellar via CCTP with USDC who then wants to hold native
  XLM needs a second step. OverSync is that step. The flows are additive.
- The Q1 2027 roadmap item (see [`ROADMAP.md`](../ROADMAP.md)) pulls forward
  a `CCTP v2 composable fast path` that lets the SDK route the USDC leg of a
  swap through CCTP while the native-asset leg settles via OverSync HTLC.

---

## 3. Axelar ITS — Stellar availability and validator-set trust model

### 3a. What the sources say

**FACT.** Axelar's Interchain Token Service (ITS) is live on Stellar's Soroban
environment, connecting it to Axelar's General Message Passing (GMP) network,
which routes contract calls across more than 70 chains as of April 2026.
> Source: Axelar documentation, *"Stellar Interchain Token Service (ITS)"*,
> docs.axelar.dev/dev/send-tokens/stellar/intro/, accessed June 28, 2026.

**FACT.** Axelar is itself a Tendermint-based proof-of-stake blockchain.
Validators run consensus on the Axelar chain, run light clients or full nodes
for every connected chain, and stake AXL to participate. As of April 2026,
the Axelar network had roughly 70 active validators.
> Source: eco.com support article, *"What Does Axelar Do: Complete Guide to
> Cross-Chain Interoperability"*, eco.com/support/en/articles/11855161,
> May 26, 2026. Accessed June 28, 2026.

**FACT.** The Axelar architecture uses quadratic voting for confirming
cross-chain events. The full security model is described as analogous to a
layer-1 blockchain applied to cross-chain messaging.
> Source: same eco.com source as above.

**FACT.** Institutional partners routing through Axelar on Stellar include Squid
(cross-chain swap router used by Phantom, MetaMask, and Trust Wallet, with
over $4 billion in cumulative volume as of April 2026), as well as Solv and
Stronghold.
> Source: eco.com source above (Squid cumulative volume); DIFFERENTIATION.md
> for partner list.

**FACT.** Three of the highest-profile bridge exploits in history — Ronin
($625M, March 2022), Wormhole ($325M, February 2022), and Multichain ($231M,
July 2023) — resulted from compromising the validator or guardian key set, not
from breaking the underlying cryptography.
> Source: These are public record. Ronin: Ronin Network post-mortem, March 29,
> 2022, roninchain.com. Wormhole: Jump Crypto post-mortem, February 2022.
> Multichain: multiple on-chain analyses published July 2023 by Chainalysis and
> DeFiLlama. Accessed June 28, 2026.

### 3b. What this means for OverSync

**[INFERENCE]** Axelar's validator-set model is well-understood and has not
been exploited on Axelar itself. The risk being documented is architectural,
not a track-record claim against Axelar specifically.

**[OVERSYNC POSITION]** OverSync and Axelar ITS are in different trust-model
categories on one specific axis:

| Axis | Axelar ITS | OverSync v2 |
|---|---|---|
| Requires a quorum of off-chain signers to process every transfer | Yes — Axelar validator set | No — HTLC contract enforces hashlock + timelock on-chain |
| Can a compromised validator quorum redirect locked user funds? | Yes (architectural) | No — no privileged signer role in HTLC contracts |
| Supported chains | 70+ | Ethereum ↔ Stellar (v2.0); ERC-20 / Soroban assets in v2.1 |
| Institutional partners | Squid, Solv, Stronghold, others | 1inch Fusion+ resolver mesh (Q2–Q3 2027 target) |

Axelar is the right tool when chain coverage and institutional routing breadth
matter more than the trust-minimisation property. OverSync is the right tool
when the user explicitly does not want any off-chain validator set in the path.
Both markets exist and do not cannibalize each other.

---

## 4. Allbridge — Stellar positioning and wrapped-asset model

### 4a. What the sources say

**FACT.** Allbridge Core supports Stellar as a destination chain for
stablecoin bridging. The protocol uses a liquidity-pool model: the user swaps
into a source-chain pool, and the equivalent amount is paid out from a
destination-chain pool. Allbridge's own documentation confirms the model for
Stellar USDC transfers.
> Source: Allbridge, *"Exploring Stellar: How It's Different from EVM"*,
> allbridge.io/blog/core/discoverstellar/, August 19, 2025. Accessed June 28,
> 2026.

**FACT.** Allbridge Classic also supports general-asset bridging via a
validator-set model. The CoinGecko guide to Solana bridges describes Allbridge
as a "trusted bridge model, exposing it to higher custodial risks," with the
note that it "uses wrapped tokens that introduce dependency risks."
> Source: CoinGecko, *"Top 5 Bridges to Solana"*,
> coingecko.com/learn/top-solana-bridges, November 28, 2025. Accessed June 28,
> 2026.

**FACT.** Allbridge's peak TVL across all chains exceeded $400M in 2022. After
the FTX collapse it settled to a more modest but still active level; CoinGecko
reported an average TVL of over $40M in its review published November 2025.
The Stellar-specific TVL figure of ~$0.45M cited in DIFFERENTIATION.md came
from DefiLlama's `protocol/allbridge-core` Stellar pool page, accessed May 2026.
> Source: CoinGecko source above (protocol-wide TVL); DIFFERENTIATION.md
> (Stellar-specific figure, DefiLlama, May 2026).

**FACT.** When bridging to Stellar via Allbridge Core, the destination asset
is a wrapped token variant unless the destination is the native Stellar USDC
pool. Allbridge's blog post notes that USDC on Stellar via Allbridge arrives
as a pool-paired asset, not necessarily native Circle USDC.
> Source: Allbridge blog post cited above.

### 4b. What this means for OverSync

**[INFERENCE]** The small Stellar TVL on Allbridge (~$0.45M vs. ~$22M/30d
total protocol volume) suggests Stellar-specific demand for the wrapped-asset,
pool-based model is modest. This is consistent with Stellar's positioning as a
native-payments chain where the wrapped-asset abstraction adds less, not more,
value.

**[OVERSYNC POSITION]** OverSync does not serve Allbridge's retail on-ramp
use case and does not attempt to. Allbridge's integration with established
on-ramp providers and its simple UX for stablecoin bridging is a moat that
OverSync does not contest. The segment OverSync addresses — trust-conscious
users who want native-asset delivery with HTLC guarantees — is unserved by
Allbridge's pool model.

---

## 5. OverSync's HTLC trust-minimised wedge

### 5a. The on-chain guarantee

**FACT.** OverSync v2 uses Hash Time-Lock Contracts (HTLCs) on both Ethereum
(`contracts/contracts/v2/HTLCEscrow.sol`) and Stellar
(`soroban/contracts/htlc/src/lib.rs`). Each HTLC encodes three parameters:
`hashlock` (a 32-byte commitment `H(preimage)`), `timelock` (an absolute
timestamp), and `refundAddress` (always the user). The contract enforces
exactly two exit paths: claim (correct preimage presented before timelock
expiry) or refund (any caller after timelock expiry; funds return to user).
No other address — including the coordinator, any resolver, or the deploying
admin — can move locked funds outside these two paths. See
[`docs/TRUST_MODEL.md`](./TRUST_MODEL.md) for the full threat matrix.

**[OVERSYNC POSITION]** The consequence is that the trust assumption is
strictly narrower than any validator-set bridge:

| What an attacker must compromise | Axelar ITS | CCTP v2 | OverSync v2 |
|---|---|---|---|
| A quorum of off-chain signers | Yes (steals all in-flight value) | Yes (Iris attester key) | **Not applicable** — no privileged signer role |
| sha256 preimage collision | No | No | Yes (and this breaks the entire cryptographic ecosystem) |
| Ethereum consensus | Yes | Yes | Yes |
| Stellar consensus | Yes | Yes | Yes |

### 5b. What OverSync does not claim

**[OVERSYNC POSITION]** We are explicit about the boundaries of this
advantage:

- HTLC settlement has a multi-block latency floor on both chains. Sub-second
  UX is not achievable with this architecture.
- The HTLC model requires a resolver to lock the destination side. If no
  resolver is available, the source side remains locked until the timelock
  expires and the user refunds permissionlessly. This is a liveness risk, not
  a safety risk.
- OverSync does not have Axelar's chain coverage or Allbridge's retail on-ramp
  integrations. These are genuine competitive gaps on axes other than
  trust-minimisation.
- Small transfers (the "sub-$5 retail swap" use case) are uneconomical given
  safety deposit and gas overhead.

---

## 6. Where OverSync routes to external systems instead of competing

This section answers the common question: "Are you trying to replace CCTP and
Axelar?" The answer is no, and the Q1 2027 roadmap formalises this.

| Flow | OverSync's intended routing |
|---|---|
| USDC → USDC (any two CCTP chains) | Route via CCTP v2 (`ExternalBridgeRoute` adapter in SDK; pulls to Q1 2027 mainnet tranche) |
| Wrapped institutional asset → Stellar | Route via Axelar ITS (adapter in Q1 2027 mainnet tranche) |
| Native XLM ↔ ETH | Route via OverSync HTLC |
| ERC-20 ↔ Soroban asset (v2.1+) | Route via OverSync HTLC |
| USDC → native XLM in one user action | CCTP fast path for USDC leg; OverSync HTLC for native-asset leg |

The shared `@oversync/sdk` exposes an `ExternalBridgeRoute` abstraction so
third parties can publish their own adapters against the same interface without
breaking existing integrations. This design is documented in
[`DIFFERENTIATION.md`](./DIFFERENTIATION.md) and the Q1 2027 milestone in
[`ROADMAP.md`](../ROADMAP.md).

---

## 7. Sources index

| # | Source | URL | Date accessed |
|---|---|---|---|
| 1 | Stellar Development Foundation, *"Circle CCTP is Live on Stellar"* | stellar.org/blog/foundation-news/circle-cctp-is-live-on-stellar | June 28, 2026 |
| 2 | Circle, CCTP product page | circle.com/cross-chain-transfer-protocol | June 28, 2026 |
| 3 | eco.com, *"Circle CCTP V2: Native USDC Across 13+ Chains"* | eco.com/support/en/articles/11813797 | June 28, 2026 |
| 4 | Circle, *"CCTP V1 deprecation"* blog post | circle.com/blog/cctp-version-updates | June 28, 2026 |
| 5 | Axelar docs, *"Stellar ITS"* | docs.axelar.dev/dev/send-tokens/stellar/intro/ | June 28, 2026 |
| 6 | eco.com, *"What Does Axelar Do"* | eco.com/support/en/articles/11855161 | June 28, 2026 |
| 7 | Ronin Network post-mortem | roninchain.com (March 29, 2022) | June 28, 2026 |
| 8 | Jump Crypto Wormhole post-mortem | jumpcrypto.com (February 2022) | June 28, 2026 |
| 9 | Chainalysis / DeFiLlama Multichain analysis | defillama.com / chainalysis.com (July 2023) | June 28, 2026 |
| 10 | Allbridge, *"Exploring Stellar"* | allbridge.io/blog/core/discoverstellar/ | June 28, 2026 |
| 11 | CoinGecko, *"Top 5 Bridges to Solana"* | coingecko.com/learn/top-solana-bridges | June 28, 2026 |
| 12 | DefiLlama, Allbridge Core Stellar pool | defillama.com/protocol/allbridge-core | May 2026 (cited in DIFFERENTIATION.md) |
| 13 | OverSync DIFFERENTIATION.md | docs/DIFFERENTIATION.md (this repo) | — |
| 14 | OverSync TRUST_MODEL.md | docs/TRUST_MODEL.md (this repo) | — |
| 15 | OverSync ROADMAP.md | ROADMAP.md (this repo) | — |

---

*Last updated: June 28, 2026. Claims about bridge features and TVL figures
should be re-verified before any investor presentation, as the competitive
landscape moves quickly.*