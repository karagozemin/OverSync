# OverSync v2 — Trust Model FAQ for Non-Technical Readers

> **One-paragraph summary for pitch decks:** OverSync is an Ethereum ↔ Stellar bridge that removes the weakest link in every major cross-chain exploit: the off-chain validator set or attester. Instead of trusting a multisig to sign "yes, funds were locked on chain A," users lock funds in auditable smart contracts on both chains and the swap settles when a cryptographic secret is revealed. If any participant — coordinator, resolver, or operator — disappears or misbehaves, user funds either settle or refund permissionlessly. No one except the underlying blockchains themselves can steal or freeze funds.

---

## 1. Who can steal funds?

The short answer is **no single party, and no small group of parties, can steal user funds**.

User funds are locked in two independent smart contracts:

- [`contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) on Ethereum.
- [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) on Stellar.

Both contracts use **Hash Time-Locked Contracts (HTLCs)**. An HTLC is an if/then lock: if someone reveals a secret before a deadline, the funds go to a beneficiary; otherwise, after the deadline the funds automatically refund to the original user. There is no backdoor, no admin key, and no multisig that can override the contract.

**What about the coordinator?** The coordinator is a software service that helps match orders and relay the secret between chains. It never holds signing keys for the HTLC contracts, so even if the coordinator is fully compromised, an attacker cannot move funds. See the coordinator compromise scenario in [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#coordinator-compromise).

**What about the resolver?** A resolver is a liquidity provider that fills a user's order by locking the destination-side asset. A resolver can refuse to act, but the user can always wait for the timelock and refund. If a resolver tries to steal, the only money they can lose is their own safety deposit (which can be slashed by the registry for non-completion). See [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#resolver-compromise).

**The realistic risk:** To steal funds, an attacker would need to break the underlying consensus of Ethereum, Stellar, or the SHA-256 hash function itself. In practice, that means the same assumptions required to steal from any non-custodial protocol.

**How to verify:** The `non-custodial guarantees` test cases in [`contracts/test/v2/HTLCEscrow.test.ts`](../contracts/test/v2/HTLCEscrow.test.ts), [`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol), and [`soroban/contracts/htlc/src/test.rs`](../soroban/contracts/htlc/src/test.rs) explicitly check that no privileged role can move funds outside the two HTLC paths.

---

## 2. What happens if the coordinator disappears?

**New orders slow down, but existing swaps are unaffected.**

The coordinator's main job is to publish order book metadata and relay the secret preimage between the two chains. It does not custody funds. If it disappears:

- **New swaps** cannot be initiated through the UI/SDK until a replacement coordinator is online.
- **In-flight swaps** continue to be secured by the on-chain HTLC contracts. The user has two self-custody escape hatches:
  1. **Refund path** — if the resolver fails to reveal the secret, the user can wait for the timelock to expire and call `refund` directly on the source-chain contract. No coordinator required.
  2. **Manual claim path** — if the user sees the `OrderClaimed` event on the source chain, they can submit the preimage on the destination chain themselves.

Anyone can run their own coordinator from the open-source code in [`coordinator/`](../coordinator/). The order book is fully rebuildable from on-chain events, so ecosystem participants have a strong incentive to keep a replacement live.

See [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#coordinator-compromise) for the full threat matrix.

---

## 3. What if a resolver refuses to act?

**The user's funds are safe, though the swap may be delayed.**

In OverSync, a resolver is an independent liquidity provider that stakes collateral in the `ResolverRegistry` to receive order fill assignments. If a resolver simply refuses to fill an order:

- **The coordinator** can route the order to a different resolver.
- **Any participant** can run their own resolver and earn the fee by posting stake.
- **The user** can simply wait for the source-chain timelock to expire and refund their funds permissionlessly. The user loses nothing except the time value of the locked capital.

**What if a resolver locks the destination chain and then refuses to reveal the secret?** This is the "griefing" attack. Even here, the user does not lose funds: once the source-chain timelock expires, the user refunds their locked source-side funds. The misbehaving resolver, however, loses the destination-side liquidity they locked plus their safety deposit (which is slashable for non-completion). The contract tests in [`contracts/test/v2/HTLCEscrow.test.ts`](../contracts/test/v2/HTLCEscrow.test.ts) cover the refund-after-timelock path.

See [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#resolver-compromise).

---

## 4. Why are timelocks asymmetric?

**Because the two chains have very different block times and finality assumptions.**

OverSync runs across Ethereum (≈12-second blocks, ~15-minute probabilistic finality) and Stellar (≈5-second ledgers, strong finality). A "fair" symmetric timelock (e.g., 30 minutes on both sides) would be overkill for Stellar and still amply safe for Ethereum. Instead, each side's timelock is tailored to its chain's reality:

- **Ethereum side:** The timelock is set generously (minutes to hours depending on deployment parameters) to tolerate re-orgs and RPC hiccups.
- **Stellar side:** The timelock is shorter because Stellar finality is faster and more deterministic.

The cryptographic lock (`hashlock`) is symmetric: the same 32-byte commitment secures both sides. Only the time component is asymmetric, and it is set per-deployment based on live-chain conditions, not by a central party at the moment of each swap.

The net effect: if something goes wrong, one side is still within its timelock and can keep the swap alive; the other side's contract will soon allow a refund. Users never face a situation where *both* sides are frozen with no escape hatch.

See the timelock logic in [`contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) and [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs), and the explicit time-based refund tests in [`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol).

---

## 5. What does "unaudited" mean for users?

**"Unaudited" means independent security researchers have not yet reviewed the contract code in a formal, paid engagement.**

OverSync's audit status as of May 2026 is tracked in [`docs/SECURITY.md`](SECURITY.md#status):

| Asset | Status |
|---|---|
| Soroban HTLC | Unaitted. 10 unit tests. Slated for audit pre-mainnet. |
| Soroban Resolver Registry | Unaitted. Same plan as above. |
| Ethereum HTLC (`HTLCEscrow.sol`) | Unaitted. 15 Hardhat tests + Slither lint in CI. |
| Ethereum Resolver Registry | Unaitted. 6 Hardhat tests. |

**What this means for users today:**

1. **No white-hat endorsement yet.** The code has not been stress-tested by external auditors looking for edge-case exploits.
2. **Significant test coverage exists.** Foundry fuzz + invariant tests, Hardhat unit tests, and Slither static analysis are all wired into CI. The contracts are deliberately minimal and have no admin escape hatches.
3. **Mainnet is gated on audit + other pre-conditions.** The v2 mainnet path is intentionally disabled in the frontend until the contracts pass independent audit, Foundry fuzz/invariant suites are complete, and multisig governance is live. See [`README.md`](../README.md) and [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#open-questions--roadmap).

**Practical guidance for non-technical reviewers:** Treat the current testnet deployment as an experimental, risky system. Do not use it for funds you cannot afford to lose. If the audit passes with no critical or high-severity findings, that materially reduces — but does not eliminate — the residual technical risk.

---

## 6. How is this different from validator-set bridges?

**Validator-set bridges require you to trust an off-chain committee. OverSync requires you to trust only the underlying blockchains.**

Most cross-chain bridges you may have heard about (Wormhole, Axelar, CCTP-style attesters) work by having a group of independent operators sign an off-chain message saying "yes, we saw funds locked on chain A." If a majority of those operators is bribed, hacked, or coerced, attacker-controlled wrapped tokens can be minted on chain B — exactly what happened in the Ronin, Wormhole, and Multichain exploits.

OverSync does not use an attester or validator set at all. Settlement is permissionless: anyone who knows the cryptographic secret can submit it to the destination contract. No one needs to ask permission from a multisig. The contracts enforce settlement rules directly.

| Compromise scenario | Validator-set bridge | OverSync v2 |
|---|---|---|
| Attacker bribes/hacks off-chain signers | ✅ Can steal wrapped tokens | ❌ No off-chain signers exist |
| Attacker compromises a first-party attester (e.g., Circle CCTP) | ✅ Can mint without real lock | ❌ No attester consulted |
| Hash/consensus break | ❌ Cannot steal funds | ❌ Also cannot steal funds |
| Compromise Ethereum or Stellar consensus | ❌ Both fail | ❌ Both fail |

For the full competitive analysis, see [`docs/DIFFERENTIATION.md`](DIFFERENTIATION.md) and the trust comparison matrix in [`README.md`](../README.md).

---

## 7. What needs to be true before mainnet?

**OverSync v2 mainnet launch is gated by a checklist, not a calendar.**

The team has been explicit that mainnet will not be re-enabled until the following conditions are satisfied. This is documented in [`docs/TRUST_MODEL.md`](TRUST_MODEL.md#open-questions--roadmap), [`docs/SECURITY.md`](SECURITY.md#audit-preparation-checklist), and [`docs/REVIEW_RESPONSE.md`](REVIEW_RESPONSE.md).

### Audit readiness (Tranche 1 & 2)

- [ ] Two independent external audits of the Soroban HTLC and `HTLCEscrow.sol`, with public reports.
- [ ] Foundry fuzz and invariant test coverage merged and green in CI.
- [ ] Differential testing: the same `hashlock` must resolve atomically on both chains.
- [ ] Slither must-pass CI gate with no high-severity findings.

### Governance

- [ ] `ResolverRegistry` ownership transferred from the deploying EOA to a multisig (e.g., Safe or Stellar equivalent).
- [ ] After 30 days of stable operation, ownership handed to a DAO contract with a 48-hour timelock.

### Bug bounty

- [ ] Public bounty program announced (Immunefi-style or core-labs equivalent) with defined scope and payouts.

### Operational readiness

- [ ] Frontend `VITE_MAINNET_ENABLED` flag gated behind the above conditions.
- [ ] Reference coordinator and resolver productionized with monitoring, rate-limiting, and fallback RPC pools.
- [ ] Incident response playbook published and SOC2 / security review initiated.

**Bottom line for readers:** OverSync is designed to minimize trust assumptions, but it is not risk-free. The v2 testnet is a working laboratory for the trust-minimization design; mainnet will follow only after the code is independently certified and the governance rails are live.

---

## Quick reference links

- Detailed trust model: [`docs/TRUST_MODEL.md`](TRUST_MODEL.md)
- Security posture and audit plan: [`docs/SECURITY.md`](SECURITY.md)
- Resolver economics: [`docs/RESOLVERS.md`](RESOLVERS.md)
- Competitive analysis: [`docs/DIFFERENTIATION.md`](DIFFERENTIATION.md)
- Contract tests (EVM): [`contracts/test/v2/HTLCEscrow.test.ts`](../contracts/test/v2/HTLCEscrow.test.ts), [`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol), [`contracts/test/v2/ResolverRegistry.test.ts`](../contracts/test/v2/ResolverRegistry.test.ts)
- Contract tests (Soroban): [`soroban/contracts/htlc/src/test.rs`](../soroban/contracts/htlc/src/test.rs), [`soroban/contracts/resolver-registry/src/test.rs`](../soroban/contracts/resolver-registry/src/test.rs)
