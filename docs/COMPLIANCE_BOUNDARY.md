# OverSync — Compliance Boundary

> **Status:** Engineering and operational boundary document. This is not
> legal advice. OverSync's compliance posture depends on the
> jurisdictions in which it is accessed, the regulatory classification
> of the assets it moves, and evolving guidance from regulators on
> non-custodial DeFi protocols. Consult qualified counsel before making
> any compliance representation to a regulator, investor, or user.
> Open questions for counsel are flagged throughout this document.

---

## 1. Non-custodial HTLC flow (plain language)

OverSync is a bridge that lets you swap native assets between Ethereum
and Stellar without giving anyone custody of your funds. Here is how a
swap works in plain terms:

1. You lock your tokens in a **smart contract** on the source chain.
   The contract is programmed so only two things can happen:
   - Someone reveals the secret, and your funds go to the person you
     are swapping with (before a deadline).
   - The deadline passes, and your funds come back to you.
2. The Swap partner locks their tokens in the **same kind of contract**
   on the destination chain, using the same secret.
3. You reveal the secret on the destination chain to claim the counterpart
   tokens. This automatically lets the partner claim your original
   tokens on the source chain.
4. If anything goes wrong — network issue, partner goes offline,
   coordinator fails — you wait for the deadline and withdraw your
   funds back to your own wallet.

**No person or organisation ever holds your private keys or custodial
control of your assets.** The smart contracts enforce the rules; no
admin can override them.

The full technical description is in [`ARCHITECTURE.md`](../ARCHITECTURE.md)
(sections 1-6) and [`TRUST_MODEL.md`](TRUST_MODEL.md).

---

## 2. What each component can and cannot do

### 2.1 Smart contracts (HTLCEscrow + ResolverRegistry)

| Property | Can | Cannot |
|---|---|---|
| Move user funds | Execute `claimOrder` when preimage matches hashlock before timelock; execute `refundOrder` after timelock | Move funds outside these two paths. No `emergencyWithdraw`, `pause`, or `transferOwnership` exists on the HTLC contracts. |
| Admin role | Update `minSafetyDeposit` or `minFeeBps` (HTLC); call `slash` (registry) | Drain user funds from HTLCs. The registry admin can slash resolver stakes, but the slashed funds go to `slashBeneficiary`, not the admin EOA. See [`TRUST_MODEL.md`](TRUST_MODEL.md):58-74. |
| Upgrade logic | None — no proxy or upgrade mechanism exists | Upgrade itself. The contracts are immutable after deployment. |

Source: [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol),
[`contracts/contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol),
[`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs),
[`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs).

### 2.2 Coordinator

The coordinator is a publicly hosted reference service that maintains
an off-chain order book and relays secret-reveal notifications between
chains.

| Property | Can | Cannot |
|---|---|---|
| Funds | Relay metadata between chains | Sign or initiate any on-chain transaction that moves user funds. The coordinator holds no keys to any HTLC contract. |
| Data | Store order metadata (addresses, amounts, hashlocks, status) in its SQLite database | Store user private keys, seed phrases, or custodial wallet credentials. |
| Service | Shut down or rate-limit API access | Permanently lock user funds. Users can always refund on-chain regardless of coordinator availability. |

### 2.3 Resolver

A resolver is an independent operator who stakes assets in the
`ResolverRegistry` and fills swap orders by locking the counterpart
asset on the destination chain.

| Property | Can | Cannot |
|---|---|---|
| Funds | Lock counterpart assets; claim payouts when the user reveals the preimage | Steal user funds. The user is always the `beneficiary` on the source side and `refundAddress` on both sides — the resolver cannot redirect funds to itself. |
| Stake | Register and unregister freely | Slash other resolvers' stakes (only the registry admin can slash). |
| Fill decisions | Choose which orders to fill | Withhold service but cannot profit from doing so (forfeits gas + stake). |

### 2.4 Frontend

The frontend is a browser-based dApp that communicates with the
coordinator API and user wallets via WalletConnect or browser extension
(Freighter, MetaMask).

| Property | Can | Cannot |
|---|---|---|
| Keys | Request signatures via the user's wallet | Access or store the user's private keys. All transactions are signed by the user's wallet and broadcast directly. |
| Data | Display order status from the coordinator API | Persist user data server-side. The frontend is a static client-side application. |
| Network choice | Select testnet or (when enabled) mainnet | Unilaterally switch a user's network. Network selection is user-initiated and confirmed in the wallet. |

---

## 3. On-chain data exposure

All swap state lives on public blockchains. The data that is
permanently visible to anyone includes:

| Data | Location | Sensitivity |
|---|---|---|
| User wallet addresses (source and destination) | On-chain `OrderCreated` events on both chains | Public by design. Pseudonymous — no KYC is performed. |
| Hashlock (32-byte commitment) | On-chain order parameters | Public. The preimage (secret) is revealed during claim and becomes public at that point. |
| Locked amounts and assets | On-chain transfer events | Public. |
| Timelock deadlines | On-chain order parameters | Public. |
| Resolver stake amounts and identities | `ResolverRegistry` on-chain state | Public. |
| Claim and refund transactions | On-chain event logs | Public — the recipient, amount, and block timestamp of every settlement are visible. |

No PII (name, email, IP address, government ID) is ever written
on-chain by the protocol.

**Order of magnitude:** A single two-chain swap produces approximately
4-8 on-chain transactions (create, lock, claim on each side) plus
events. All metadata is comparable to a standard DEX swap on either
chain. See [`ARCHITECTURE.md`](../ARCHITECTURE.md):109-129 for the
atomic-swap flow.

---

## 4. Data the project should avoid collecting

The reference coordinator stores only the data necessary to maintain
the off-chain order book and relay service. This is stored in a local
SQLite database and includes:

- Order ID (UUID)
- Source and destination chain, asset, amount
- Hashlock
- Status (created, locked, claimed, refunded)
- Timestamps

The coordinator **deliberately avoids** collecting:

- IP addresses from API requests (no request logging is configured in the
  reference deployment, though operators may add their own)
- User wallet session data beyond order metadata
- Browser fingerprints or device identifiers
- Email addresses or any contact information
- KYC documents or identity verification data
- Geographic location data

> **Counsel question:** Does the reference coordinator's lack of IP
> logging affect GDPR / ePrivacy compliance in EU jurisdictions, where
> the dynamic IP address of an API client may be considered personal
> data? Should operators be advised to enable anonymised access logs
> (e.g., truncated IPs) for abuse monitoring while staying outside
> data-protection triggers?

> **Counsel question:** If an operator deploys a modified coordinator
> that logs IP addresses or additional metadata, what disclosure
> obligations arise? Should this document recommend a minimum data
> handling policy for operators?

---

## 5. Sanctions and geofencing

### 5.1 Current posture

The protocol has **no sanctions screening, no geofencing, and no
blocklist** at the smart contract level. This is by design: the HTLC
contracts are permissionless and immutable. They cannot be modified to
filter addresses or jurisdictions after deployment.

The reference frontend and coordinator are public services. The
coordinator does not perform IP-based geolocation or deny service based
on jurisdiction.

### 5.2 Implications

| Scenario | Outcome |
|---|---|
| An OFAC-sanctioned address interacts with the HTLC contracts directly | The contracts execute the swap or refund as programmed. The protocol cannot prevent direct contract interaction. |
| An OFAC-sanctioned address uses the reference coordinator or frontend | The operator may choose to deny service (at the API or CDN layer) but the on-chain path remains open. |
| A regulator requests transaction data from the project | The project holds no PII beyond what is already public on-chain. Order metadata stored by the coordinator is limited to swap parameters. |
| A jurisdiction declares non-custodial DeFi protocols illegal | Users in that jurisdiction can still interact with the contracts directly. The project may need to block frontend access from that jurisdiction. |

### 5.3 Recommended posture

> **Note:** These are engineering and operational recommendations, not
> legal conclusions. The appropriate sanctions strategy depends on the
> project's corporate structure, user base, and the jurisdictions where
> it operates or is accessible.

1. **Frontend geofencing (optional).** The reference frontend can serve
   a jurisdiction-blocking page at the CDN or reverse-proxy layer if
   required by the project's legal structure. This is not implemented
   in the current codebase and would be a deployment-time configuration.
2. **Coordinator rate-limit / deny (optional).** The coordinator API
   can reject requests from specific IP ranges. The reference
   deployment uses Cloudflare; IP-based rules can be configured there.
3. **No on-chain filtering.** The HTLC contracts will never include
   address blocklists or jurisdiction checks. This is a non-custodial
   invariant — any filtering would require an admin role that could
   censor settlements, contradicting the project's trust model.
4. **Resolver-side discretion.** Individual resolver operators may
   choose to filter orders based on their own compliance policies. The
   protocol does not enforce or police this.

> **Counsel question:** Should the project form a legal entity in a
> specific jurisdiction before mainnet, and what sanctions-screening
> obligations would that entity have for a non-custodial, non-托管
> protocol? How does the OFAC guidance on decentralised finance
> (2024-2026) apply to immutable HTLC contracts deployed by a now-dormant
> deployer key?

---

## 6. Responsible wording for investor and SCF materials

Based on the engineering boundary described above, the following
framing is consistent with the protocol's design:

| Claim | Appropriate wording | Avoid |
|---|---|---|
| Custody | *"Non-custodial — users maintain sole control of their private keys; the protocol never takes custody of user funds."* | *"Fully trustless"* or *"completely safe"* — no protocol eliminates all risk (smart contract bug, chain reorg, user error). |
| Compliance | *"The protocol does not collect KYC data, store PII, or gate access based on jurisdiction at the contract layer."* | *"Fully compliant"* or *"licenced in [jurisdiction]"* — no specific compliance claim is made. |
| Admin control | *"The HTLC contracts have no admin escape hatch or upgrade mechanism. The ResolverRegistry admin can slash staked resolvers via a timelocked governance path (planned multisig)."* | *"No admin can ever affect the protocol"* — the registry admin has liveness authority over resolver stakes. |
| Data | *"All swap data is public on-chain. The coordinator stores only order metadata; no PII is collected by the reference implementation."* | *"No data is stored or collected"* — coordinator operators may log operational data. |
| Audit | *"Smart contracts are unaudited pre-mainnet. Independent audits are scheduled for Q4 2026, and mainnet launch is gated on clean audit results."* | *"Audited"[^1] or "secure"* — pre-audit claims of security are misleading. |

[^1]: OverSync contracts have not been audited as of this writing.
    See [`SECURITY.md`](SECURITY.md):7-15 for the current audit status.

---

## 7. Open questions for counsel before mainnet

1. **Entity structure.** Should the project incorporate as a
   non-profit foundation (similar to Stellar Development Foundation),
   a C-corp, or another structure before mainnet launch? What are the
   liability implications for core contributors?
2. **Securities classification.** Could the safety deposit or resolver
   stakes be classified as investment contracts under the Howey test?
   See [`ARCHITECTURE.md`](../ARCHITECTURE.md):162-180 for the safety
   deposit mechanism.
3. **Money transmission.** Does operating a coordinator and frontend
   for a non-custodial bridge constitute money transmission in the
   United States, given the protocol never takes custody but does
   relay order metadata?
4. **Sanctions / OFAC.** What obligations arise from operating a
   publicly accessible coordinator and frontend, given that the
   contracts themselves are permissionless and immutable?
5. **GDPR / data protection.** Does storing order metadata (addresses,
   amounts, timestamps) in the coordinator's SQLite database constitute
   processing of personal data under GDPR? Are the pseudonymous wallet
   addresses in swap metadata considered personal data?
6. **Stellar-specific regulation.** Does the Stellar network's
   compliance infrastructure (e.g., SEP-6, SEP-24 anchor transfers)
   impose any obligations on bridge operators that OverSync should
   plan for?
7. **Bug bounty and disclosure.** What are the legal parameters for a
   public bug bounty programme? Should the project adopt a
   vulnerability disclosure policy that covers safe-harbour provisions?
   See [`SECURITY.md`](SECURITY.md):81-91 for the current bounty plan.

---

## References

| Document | Relevance |
|---|---|
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Technical design — atomic-swap flow, trust model summary, failure mode catalogue |
| [`TRUST_MODEL.md`](TRUST_MODEL.md) | Detailed threat scenarios — coordinator compromise, resolver compromise, single-chain failure |
| [`SECURITY.md`](SECURITY.md) | Audit status, threat model (STRIDE), bug bounty plan, out-of-scope items |
| [`README.md`](../README.md) | Bridge overview, deployment status, testnet contract addresses |
| [`ROADMAP.md`](../ROADMAP.md) | Timeline — audit schedule, mainnet gate, multisig migration |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Operational deployment guidance for testnet and future mainnet |
| [`INVESTOR_ONE_PAGER.md`](INVESTOR_ONE_PAGER.md) | Investor-facing summary — uses the recommended wording conventions above |
