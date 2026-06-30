# OverSync — Launch Narrative Kit

> **Who this is for.** Anyone writing public-facing copy about OverSync: the
> founding team, SCF updates, investor follow-up emails, partner outreach, and
> social media drafts. Every approved claim below is traceable to a source or
> is explicitly marked as a roadmap item. The "do not say" section exists
> because overclaiming is the fastest way to lose a technical reviewer's trust.
>
> **Related documents.**
> - Competitive evidence: [`docs/COMPETITIVE_PROOF_POINTS.md`](./COMPETITIVE_PROOF_POINTS.md)
> - Full competitive analysis: [`docs/DIFFERENTIATION.md`](./DIFFERENTIATION.md)
> - Trust model: [`docs/TRUST_MODEL.md`](./TRUST_MODEL.md)
> - Roadmap and milestones: [`ROADMAP.md`](../ROADMAP.md)
> - SCF review response: [`docs/REVIEW_RESPONSE.md`](./REVIEW_RESPONSE.md)

---

## 1. Short description (≤ 280 characters)

> OverSync is a non-custodial Ethereum ↔ Stellar bridge. Funds are locked
> in hash-time-lock contracts on both chains — no validator set, no attester,
> no admin escape hatch. Currently live on testnet; audit-gated for mainnet.

**Evidence base.** The HTLC constraint is enforced in
`contracts/contracts/v2/HTLCEscrow.sol` (EVM) and
`soroban/contracts/htlc/src/lib.rs` (Stellar). The "no admin escape hatch"
property is covered by a dedicated test: `non-custodial guarantees > contract
has no admin escape hatch` in `contracts/test/v2/HTLCEscrow.test.ts`.
The testnet deployment addresses are listed in `README.md`.

---

## 2. Long description (150–250 words)

> OverSync moves native assets between Ethereum and Stellar without any
> off-chain validator committee, attester key, or operator custody. Both sides
> of a swap are locked in on-chain hash-time-lock contracts (HTLCs); settlement
> is a sha256 preimage reveal. If anything fails — coordinator goes down,
> resolver disappears, RPC is rate-limited — the user's funds either settle to
> the beneficiary or return permissionlessly to the original wallet. There is
> no state in which funds sit under operator control.
>
> This is different from the other Stellar bridges shipping in 2026:
>
> - **CCTP v2** (live on Stellar mainnet, May 2026) moves USDC only. OverSync
>   moves native XLM, ETH, and arbitrary ERC-20s.
> - **Axelar ITS** (live on Stellar, February 2026) uses a validator-set
>   attestation model. OverSync removes the validator quorum from the path
>   entirely.
> - **Allbridge** uses liquidity pools and delivers wrapped tokens. OverSync
>   delivers the native asset on the destination chain.
>
> OverSync is designed to complement these bridges, not displace them. The
> Q1 2027 mainnet launch ships with a CCTP v2 fast path and an Axelar ITS
> adapter built in.
>
> **Current status:** testnet live on Sepolia + Stellar testnet. Mainnet is
> gated on Foundry fuzz testing, cross-chain differential tests, multisig
> governance, and two independent audits.

---

## 3. Reviewer-safe claims

These are the statements that can be made publicly, in grant applications,
investor materials, and partner outreach without risk of being contradicted
by a technical reviewer. Each claim has a verifiable evidence pointer.

### 3.1 Technical claims

| Claim | Evidence |
|---|---|
| OverSync uses symmetric HTLCs on both chains — EVM and Soroban | `HTLCEscrow.sol` lines 100-220 (`claimOrder`, `refundOrder`); `soroban/contracts/htlc/src/lib.rs` (`claim_order`, `refund_order`) |
| No privileged signer, admin key, or operator can redirect locked funds | Dedicated test: `non-custodial guarantees > contract has no admin escape hatch` in `contracts/test/v2/HTLCEscrow.test.ts` |
| Refunds are permissionless: any address can call `refundOrder` after timelock expiry; funds always return to the user's wallet | `HTLCEscrow.sol` `refundOrder` function; Soroban `refund_order`; tested by `returns the locked amount to the refund address after timeout, permissionlessly` |
| v2 uses a native Soroban HTLC — not claimable balances | `soroban/contracts/htlc/src/lib.rs`; 10 Rust unit tests passing in CI |
| The resolver network is open: anyone who stakes in `ResolverRegistry` can fill orders | `contracts/contracts/v2/ResolverRegistry.sol`; `soroban/contracts/resolver-registry/src/lib.rs`; `docs/RESOLVERS.md` |
| 43 automated tests across Rust, Solidity, and TypeScript, all enforced in CI | `.github/workflows/ci.yml`; test count by layer in `README.md` |
| The coordinator holds no keys that can move user funds | `docs/TRUST_MODEL.md` threat scenario: "Coordinator compromise" |
| The frontend is testnet-only; mainnet is disabled (`VITE_MAINNET_ENABLED=false`) | `frontend/.env.example`; README status block |

### 3.2 Ecosystem positioning claims

| Claim | Evidence |
|---|---|
| CCTP v2 is USDC-only; OverSync moves native XLM, ETH, and ERC-20s — the use cases are complementary | `docs/DIFFERENTIATION.md`; `docs/COMPETITIVE_PROOF_POINTS.md` §2 |
| Axelar ITS uses a validator-set model (~70 active validators, Tendermint PoS); OverSync requires no off-chain quorum | `docs/COMPETITIVE_PROOF_POINTS.md` §3; eco.com Axelar guide, May 2026 |
| Allbridge Stellar TVL is ~$0.45M (DefiLlama, May 2026); Allbridge delivers wrapped tokens, not the native asset | `docs/COMPETITIVE_PROOF_POINTS.md` §4; `docs/DIFFERENTIATION.md` |
| The three largest bridge hacks (Ronin $625M, Wormhole $325M, Multichain $231M) all resulted from compromising off-chain validator sets, not from breaking cryptography | `docs/COMPETITIVE_PROOF_POINTS.md` §3; public post-mortems cited there |
| OverSync's Q1 2027 mainnet launch includes a CCTP v2 composable fast path and an Axelar ITS adapter | `ROADMAP.md` Q1 2027 milestone table |

### 3.3 Status and process claims

| Claim | Evidence |
|---|---|
| v2 is live on testnet (Sepolia + Stellar testnet) with real contract addresses | `README.md` "Live operational status" table with Etherscan and Stellar Expert links |
| Mainnet launch is gated on Foundry fuzz + invariant tests, Slither must-not-fail CI, differential cross-chain tests, multisig governance, and two independent audits | `ROADMAP.md` Q3 2026 and Q4 2026 milestone tables |
| The SCF grant request is $40,000, tranche-gated, mapped to concrete engineering deliverables | `docs/REVIEW_RESPONSE.md` §9 |
| A public testnet frontend is live at `https://testnet.oversync.app` | `README.md` Off-chain services table |

---

## 4. Do not say — forbidden and unsafe claims

This section is as important as the claims above. These phrases will get
OverSync flagged by a technical reviewer and can cause disproportionate
damage to the SCF application and investor credibility.

### 4.1 Mainnet and production claims

| ❌ Do not say | Why | Safe alternative |
|---|---|---|
| "OverSync is live" (without qualification) | v2 mainnet is not live; only testnet is deployed | "OverSync v2 is live on testnet (Sepolia + Stellar testnet)" |
| "Production-ready" | The previous v1 review specifically flagged this phrase as unsupported; using it again will be noticed | "Testnet-deployed; audit-gated for mainnet" |
| "Battle-tested" | No mainnet TVL has been at risk | Omit entirely |
| "Mainnet launching [specific date]" | Q1 2027 is a target range, not a pinned date; audit findings can move it | "Q1 2027 target, conditioned on clean independent audits" |
| "99.x% uptime" or any specific uptime figure | The previous review flagged a fabricated uptime claim; there are no mainnet measurements | Do not cite uptime until a public status page with SLOs is live |

### 4.2 Market-size and TVL claims

| ❌ Do not say | Why | Safe alternative |
|---|---|---|
| Any TVL or volume figure for OverSync itself | No mainnet TVL exists; testnet figures are not user funds | Do not cite OverSync TVL until the public dashboard is live post-mainnet |
| "$X billion cross-chain market" without sourcing | Unsourced market-size claims are a red flag for SCF and technical investors | Omit or cite a specific, dated source |
| "OverSync will capture X% of Stellar's bridging volume" | No basis for a market-share projection at this stage | Omit entirely |
| "Larger than Allbridge" / "bigger than Axelar" | False and would be immediately disproven | Reference the Allbridge Stellar TVL (~$0.45M, DefiLlama May 2026) and the unserved niche OverSync addresses |

### 4.3 Audit and security claims

| ❌ Do not say | Why | Safe alternative |
|---|---|---|
| "Audited" | No external audit has been completed | "Audit preparation in progress (Q3 2026 target); external audits planned for Q4 2026" |
| "Secure" as a standalone adjective | Every bridge that has been exploited was also described as "secure" | Describe the specific trust assumption: "settlement governed by sha256 hashlock and on-chain timelock; no validator quorum in the path" |
| "Trust-minimized" without explanation | Means nothing without specifying compared to what | "Trust-minimized relative to validator-set bridges: no off-chain quorum can redirect locked funds" |
| "Hack-proof" / "can't be hacked" | False; sha256 break or consensus compromise would affect OverSync | Omit |

### 4.4 Partnership claims

| ❌ Do not say | Why | Safe alternative |
|---|---|---|
| "In partnership with 1inch" | Only "initial outreach" as of May 2026 (TRACTION.md) | "Pursuing 1inch Fusion+ integration; design is resolver-compatible with the Fusion+ protocol" |
| "Backed by [investor name]" until closed | Self-explanatory | Omit until formally announced |
| "Endorsed by Stellar Development Foundation" | No endorsement documented | "Applied for SCF funding" / "participating in the SCF programme" |
| "Partnered with [wallet name]" | Not yet contacted as of May 2026 | Omit |

### 4.5 Resolver and liquidity claims

| ❌ Do not say | Why | Safe alternative |
|---|---|---|
| "Liquidity available" | No community resolvers are yet operating; the reference resolver is a testnet instance | "An open resolver network is live on testnet; community resolver onboarding is a mainnet-launch milestone" |
| "Instant settlement" | HTLC settlement has a multi-block floor on both chains | "Atomic settlement; latency is bounded by block confirmation times on both chains" |
| "Better than CCTP v2" | CCTP v2 is strictly better for USDC-only flows | "Complementary to CCTP v2: handles native XLM ↔ ETH where CCTP only moves USDC" |

---

## 5. Tweet / thread draft

These drafts are ready to publish or adapt. All claims trace to §3 above.

### 5a. Testnet announcement tweet (single tweet)

> OverSync v2 testnet is live on Sepolia + Stellar testnet.
>
> Native XLM ↔ ETH, no validator committee, no admin escape hatch.
> Funds are locked in on-chain HTLCs on both chains — sha256 preimage
> settles the swap, timelock returns funds if anything fails.
>
> Mainnet: audit-first. 🔗 [testnet.oversync.app]

### 5b. Ecosystem positioning thread (5 tweets)

**Tweet 1 / 5**
> What does the Stellar bridging landscape look like right now, and where does OverSync fit?
>
> (thread 🧵)

**Tweet 2 / 5**
> CCTP v2 went live on Stellar mainnet last month. Native USDC ↔ USDC across 23 chains, no wrapped tokens, Circle-signed attestation.
>
> This is excellent — and it only moves USDC.
>
> If you want native XLM on the other side, you need something else.

**Tweet 3 / 5**
> Axelar ITS has been live on Stellar since February 2026. 70+ chains, strong institutional partners, a real validator set.
>
> The trust model: ~70 validators produce threshold signatures to move your funds. If a quorum is compromised, in-flight value is at risk.
>
> Ronin ($625M), Wormhole ($325M), Multichain ($231M) all failed this way.

**Tweet 4 / 5**
> OverSync's trust model: sha256(preimage) on-chain.
>
> No validator quorum can redirect your funds. The contract has two exit paths: correct preimage → beneficiary. Timelock expires → you.
>
> We give up chain coverage (ETH ↔ XLM only, v2.0) to get there. That tradeoff is intentional.

**Tweet 5 / 5**
> These three aren't competing — they're different tools for different flows.
>
> USDC ↔ USDC → CCTP v2.
> Wrapped institutional assets → Axelar ITS.
> Native XLM ↔ ETH with no committee → OverSync.
>
> Our Q1 2027 mainnet ships with CCTP and Axelar adapters built in.
>
> Testnet live. Audit-first. 🔗 [testnet.oversync.app]

### 5c. SCF update tweet

> OverSync SCF update: v2 rebuild is complete on testnet.
>
> ✅ Native Soroban HTLC (replaces claimable balances)
> ✅ Open resolver network (replaces single-relayer)
> ✅ Permissionless refunds (user wallet calls `refundOrder` directly)
> ✅ 43 automated tests in CI
>
> Mainnet: gated on fuzz tests + independent audit (Q4 2026 → Q1 2027).

---

## 6. Partner announcement boilerplate

Use these templates when a partnership or integration is formally confirmed.
**Do not use until an MoU or equivalent agreement is signed.**

### 6a. Resolver partner (exchange / market-maker)

> [Partner] is now operating as a registered resolver on the OverSync
> testnet. As a resolver, [Partner] locks XLM on Stellar against the
> user's locked ETH on Ethereum; settlement is a sha256 preimage reveal
> with no intermediary validator set.
>
> What this means for [Partner]'s users: trust-minimised Ethereum ↔
> Stellar swaps, delivered through [Partner]'s existing interface.
>
> OverSync's open resolver registry means any team can participate —
> see `docs/RESOLVERS.md` to run your own instance.

### 6b. Wallet integration partner

> [Wallet] now surfaces OverSync swaps natively. Users can move native
> XLM ↔ ETH directly from [Wallet]'s swap interface, with settlement
> guaranteed by on-chain HTLCs on both Ethereum and Stellar.
>
> Technical implementation: the OverSync `@oversync/sdk` `SorobanSigner`
> callback accepts any Stellar wallet, including Freighter and WalletConnect,
> with no additional key-management overhead.

### 6c. Ecosystem / grant-body update

> OverSync is participating in [Programme]. The v2 rebuild delivers the
> trust-minimised native-asset bridge that the SCF review feedback asked
> for: Soroban HTLC, permissionless refunds, open resolver network, and
> an audit-first mainnet timeline.
>
> Grant funds are mapped to concrete deliverables (Foundry fuzz suite,
> differential cross-chain tests, community resolver onboarding grants)
> and are released in two tranches gated on delivery. See
> `docs/REVIEW_RESPONSE.md` for the full breakdown.

---

## 7. Ecosystem positioning beside CCTP, Axelar, and Allbridge

This section is the one-paragraph version of `docs/DIFFERENTIATION.md`
for use in introductory pitches and SCF application summaries.

> **The positioning sentence:** OverSync is complementary to every other
> Stellar bridge shipping in 2026, not a direct replacement for any of them.

### The single paragraph

The Stellar cross-chain market has three active bridges entering 2026:
CCTP v2 (USDC-only, Circle attestation, now live on Stellar mainnet),
Axelar ITS (generalist token routing, validator-set model, 70+ chains,
live on Stellar since February 2026), and Allbridge (stablecoins +
select assets, liquidity-pool model, ~$0.45M Stellar TVL per DefiLlama
May 2026). Each addresses a real user need. None removes the validator
or attester from the path for native-asset swaps. OverSync is the HTLC
layer that does: XLM ↔ ETH atomically, with settlement governed
entirely by on-chain math and no privileged signer. The Q1 2027 mainnet
launch ships with first-class adapters for both CCTP v2 and Axelar ITS,
so a single SDK call can route the right leg of any swap to the right
protocol.

### At-a-glance table (reprinted from DIFFERENTIATION.md)

| Bridge | Live on Stellar | Asset scope | Trust model | OverSync's relationship |
|---|---|---|---|---|
| **CCTP v2** | Mainnet (May 2026) | USDC only | Circle Iris attestation | Complementary — USDC leg routes via CCTP; native-asset leg via OverSync |
| **Axelar ITS** | Mainnet (Feb 2026) | Any token (wrapped) | Axelar validator set (~70 validators, Tendermint PoS) | Complementary — OverSync addresses the segment that rejects validator-set trust |
| **Allbridge** | Mainnet (established) | Stablecoins + select assets (liquidity-pool model) | Allbridge validator set | Complementary — different TVL segment; OverSync targets trust-conscious users Allbridge does not serve |
| **OverSync v2** | Testnet (v2); mainnet Q1 2027 | Native XLM ↔ ETH; ERC-20s + Soroban assets (v2.1) | HTLC — sha256 hashlock + on-chain timelock; no validator quorum | — |

For full sourced evidence on each row, see
[`docs/COMPETITIVE_PROOF_POINTS.md`](./COMPETITIVE_PROOF_POINTS.md).

---

## 8. Reuse guide

| Audience | Recommended sections | Notes |
|---|---|---|
| **SCF application body** | §1 short description, §3 reviewer-safe claims, §7 ecosystem positioning | Do not include TVL projections or unconfirmed partnership names |
| **SCF progress update** | §5c SCF update tweet, §3.3 status claims | Always state current testnet status explicitly |
| **Investor one-pager** | §2 long description, §7 single paragraph, §3.1 technical claims | Pair with `docs/COMPETITIVE_PROOF_POINTS.md` as appendix |
| **Twitter / X announcement** | §5a testnet tweet or §5b ecosystem thread | Do not modify the "audit-first" and "testnet" qualifiers |
| **Partner outreach email** | §6a or §6b boilerplate + §7 positioning paragraph | Replace bracketed placeholders; do not use until agreement signed |
| **Developer Discord / forum post** | §3.1 technical claims table + links to TRUST_MODEL.md and RESOLVERS.md | Technical audiences want contract addresses and test names, not marketing copy |
| **Press / media** | §1 + §2 + §4 (share the do-not-say list with anyone writing on our behalf) | Brief any external writer with §4 before they publish |

---

*Last updated: June 28, 2026. Re-verify §3.3 status claims before each
use — testnet addresses, test counts, and mainnet timeline milestones
change as development progresses.*