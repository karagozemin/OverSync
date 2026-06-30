# OverSync v2 — Governance Path

This document maps every privileged on-chain role across EVM and Soroban
components, states precisely what each role can and cannot do, and defines
the concrete steps for moving those roles to progressively less centralised
control before and after mainnet. It is intended as a primary reference for
bridge investors, SCF reviewers, and external auditors.

---

## 1. Canonical contract registry

All addresses below are from [`deployments.testnet.json`](../deployments.testnet.json).

| Chain | Contract | Address | Source |
|---|---|---|---|
| Sepolia (EVM) | `HTLCEscrow` | `0xb352339BEb146f2699d28D736700B953988bB178` | [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) |
| Sepolia (EVM) | `ResolverRegistry` | `0x7D9ce70Aa40E144E8BbE266a0dc3b3F91B6D1D99` | [`contracts/contracts/v2/ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol) |
| Stellar testnet | `HTLC` | `CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK` | [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) |
| Stellar testnet | `ResolverRegistry` | `CBSR7Z4MHLPMLFFM5K3PK3YLZAVCOMJ4KPVRWO4VPL3FF64MSTIZ4WGF` | [`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs) |

**Testnet deployer EOA (EVM):** `0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c`  
**Testnet deployer account (Stellar):** `GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL`

> The legacy v1 contracts (`HTLCBridge.sol`, `EscrowFactory.sol`,
> `MainnetHTLC.sol`) remain in the repository for reference but are **not**
> reachable from the v2 frontend and are not covered by this governance path.

---

## 2. Current privileged roles

### 2.1 EVM — `HTLCEscrow`

**Admin role: none.**

`HTLCEscrow` does not inherit `Ownable` or any access-control pattern. There is
no `owner`, no `emergencyWithdraw`, and no `pause`. The contract is
non-custodial by construction: user funds locked under a hashlock and timelock
can only leave through `claimOrder` (correct preimage, before timelock) or
`refundOrder` (permissionless, after timelock). Source: lines 1–41 in
[`HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol).

The `resolverRegistry` pointer is set at deploy time and is **immutable**
(`IResolverRegistry public immutable resolverRegistry`). To change the registry
the protocol must deploy a new `HTLCEscrow`.

### 2.2 EVM — `ResolverRegistry`

**Admin role: `owner` (OpenZeppelin `Ownable2Step`)**

Current holder: deployer EOA `0x686Be1DEF4b9Bd725A5Df07505E25a94Fa71394c`

| Function | Effect | Can it move user HTLC funds? |
|---|---|---|
| `slash(resolver, amount)` | Takes `amount` from `resolver.stake`; sends to `slashBeneficiary` | No — stake is resolver-posted collateral, not user deposits |
| `setMinStake(newMinStake)` | Changes the minimum stake threshold for `active` status | No |
| `setSlashBeneficiary(newBeneficiary)` | Redirects future slash proceeds | No |
| `transferOwnership(newOwner)` | Initiates `Ownable2Step` two-step owner transfer | No — it only changes who can call the above |
| `acceptOwnership()` | Completes the pending transfer (must be called by `pendingOwner`) | No |

Source: lines 141–170 in [`ResolverRegistry.sol`](../contracts/contracts/v2/ResolverRegistry.sol).

### 2.3 Soroban — `HTLC`

**Admin role: `Admin` key in instance storage**

Current holder: `GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL`

| Function | Effect | Can it move user HTLC funds? |
|---|---|---|
| `set_resolver_registry(registry)` | Points the HTLC to a new registry contract | No |
| `clear_resolver_registry()` | Removes the registry binding (makes `create_order` permissionless) | No |
| `set_min_safety_deposit(new_minimum)` | Raises or lowers the minimum deposit required at order creation | No |
| `set_admin(new_admin)` | Transfers the admin role in a single step | No — only admin-function access changes |

Source: lines 183–207 in [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs).

`claim_order` and `refund_order` are **always permissionless** regardless of
admin state: the code comment on line 166 reads *"The admin can NEVER move
user funds."*

### 2.4 Soroban — `ResolverRegistry`

**Admin role: `Admin` key in instance storage**

Current holder: `GC4VWBK5QSJCBSRWIZJYWCF2SJAPCKU3OFHH4XK7ZBTZ5HCK7VYLU6FL`  
Config at deploy: `minStake = 1 000 000 000 stroops (100 XLM)`,
`slashBeneficiary = deployer address` (see
[`deployments.testnet.json`](../deployments.testnet.json) §`resolverRegistryConfig`).

| Function | Effect | Can it move user HTLC funds? |
|---|---|---|
| `slash(resolver, amount)` | Takes up to `amount` of `stake_asset` from the resolver; sends to `slash_beneficiary` | No — stake is resolver-posted collateral |
| `set_min_stake(new_minimum)` | Changes the minimum stake required for `active` status | No |
| `set_slash_beneficiary(new_beneficiary)` | Redirects future slash proceeds | No |
| `set_admin(new_admin)` | Transfers the admin role in a single step | No — only admin-function access changes |

Source: lines 225–310 in [`soroban/contracts/resolver-registry/src/lib.rs`](../soroban/contracts/resolver-registry/src/lib.rs).

---

## 3. What every privileged role cannot do

The table below is the definitive statement for diligence reviewers.

| Action | EVM `ResolverRegistry` owner | Soroban `HTLC` admin | Soroban `ResolverRegistry` admin |
|---|---|---|---|
| Withdraw user HTLC deposits | **Impossible** — no such function exists | **Impossible** — no such function exists | **Impossible** — HTLC is a separate contract |
| Pause or freeze user claims | **Impossible** — HTLCEscrow has no pause | **Impossible** — `claim_order` is permissionless | N/A |
| Pause or freeze user refunds | **Impossible** | **Impossible** — `refund_order` is permissionless | N/A |
| Steal a resolver's stake without a `slash` call | **Impossible** — stake leaves contract only via `unregister` or `slash` | N/A | **Impossible** — same guarantee |
| Redirect slashed funds to themselves instead of `slashBeneficiary` | Only by first calling `setSlashBeneficiary` (auditable) | N/A | Only by first calling `set_slash_beneficiary` (auditable) |
| Modify the `HTLCEscrow` registry pointer | **Impossible** — pointer is `immutable` | Can change via `set_resolver_registry` | N/A |

**Core invariant:** user funds in any HTLC contract move exclusively through
`claimOrder`/`claim_order` (correct preimage + within timelock) or
`refundOrder`/`refund_order` (after timelock). No privileged role touches
either path. This is verified by the Foundry test
`non-custodial guarantees > contract has no admin escape hatch` in
[`contracts/test/foundry/HTLCEscrow.t.sol`](../contracts/test/foundry/HTLCEscrow.t.sol).

---

## 4. What remains centralised before mainnet

The following risks are **acknowledged and bounded**. They will be eliminated
according to the schedule in §5 and §6.

1. **EVM `ResolverRegistry` owner is a single EOA.** A compromised deployer
   key can slash any registered resolver's stake (up to their posted bond) and
   redirect slash proceeds. Upper-bound damage: total resolver stakes in the
   registry. User HTLC balances are unaffected.

2. **Soroban `HTLC` admin is a single account.** That account can change the
   minimum safety deposit and swap the resolver registry binding. It cannot
   move locked funds. A hostile admin pointing `set_resolver_registry` at a
   malicious contract could disrupt *new* order creation but cannot affect
   orders already funded.

3. **Soroban `ResolverRegistry` admin is a single account** with the same
   slash/redirect risks described in point 1.

4. **`slashBeneficiary` on both chains is the deployer address.** Any slashed
   stake currently flows back to the team. This will be changed to a community
   treasury address as part of the multisig migration.

5. **No on-chain timelock.** Admin actions take effect immediately. A
   compromised key has no built-in delay for the community to respond.

---

## 5. Testnet multisig step (2-of-3)

**Target:** Q4 2026, concurrent with the multisig migration milestone in
[`ROADMAP.md`](../ROADMAP.md).

**Scope:** transfer owner/admin on all four contracts to a 2-of-3 multisig
before the external audit reports are published.

### 5.1 EVM side

1. Deploy a [Safe](https://safe.global) `2/3` multisig on Sepolia with the
   three initial signers documented in `deployments.testnet.json` (to be added
   at migration time).
2. Call `ResolverRegistry.transferOwnership(safeAddress)` from the current
   owner EOA.
3. Call `ResolverRegistry.acceptOwnership()` from the Safe.
4. Verify: `ResolverRegistry.owner() == safeAddress` on Sepolia Etherscan.
5. Update `deployments.testnet.json` with `multisigOwner` field.

No action is required for `HTLCEscrow` — it has no admin role.

### 5.2 Stellar side

1. Create a Stellar M-of-N multisig account (initial: 2-of-3 signers) using
   the standard `SET_OPTIONS` threshold mechanism.
2. Call `HTLC::set_admin(multisig_account)` from the current admin account.
3. Call `ResolverRegistry::set_admin(multisig_account)` from the current admin
   account.
4. Optionally call `ResolverRegistry::set_slash_beneficiary(treasury_account)`
   at the same time.
5. Verify: `HTLC::admin()` and `ResolverRegistry` admin storage return the
   multisig account via Stellar Expert or a direct RPC call.
6. Update `deployments.testnet.json` with `multisigAdmin` field.

### 5.3 Acceptance artifacts

The following artifacts must be committed to the repository before the
milestone is marked complete:

- [ ] `deployments.testnet.json` updated: `multisigOwner` (EVM Safe address)
      and `multisigAdmin` (Stellar multisig account) populated.
- [ ] EVM: Etherscan transaction link for `acceptOwnership` confirming the
      Safe is the new `owner`.
- [ ] Stellar: Stellar Expert link for `set_admin` transaction confirming the
      multisig account is the new admin.
- [ ] CHANGELOG.md entry with date, old address, new address, and rationale.
- [ ] A `scripts/verify-multisig-ownership.ts` script (or equivalent) that
      reads `owner()`/`admin()` on-chain and compares to `deployments.testnet.json`.

---

## 6. Mainnet multisig criteria

The mainnet deployment must satisfy all of the following before the owner/admin
roles are set to anything other than a multisig:

| Criterion | Verification |
|---|---|
| Both audit reports are public | Links in `SECURITY.md` and `CHANGELOG.md` |
| All medium+ audit findings are remediated and confirmed by auditors | Annotated PRs linking finding IDs to diffs |
| Bug bounty programme has been open ≥ 14 days with no critical reports | Bounty platform URL committed to `SECURITY.md` |
| Mainnet Safe (EVM): ≥ 3 signers, ≥ 2-of-3 threshold | Verified on Etherscan — `getThreshold()` and `getOwners()` |
| Mainnet multisig (Stellar): ≥ 3 signers, ≥ 2-of-3 threshold | Verified on Stellar Expert — account thresholds |
| `slashBeneficiary` points to a community treasury, not a team EOA | On-chain read + announcement |
| `deployments.mainnet.json` committed with all multisig addresses | Repo commit SHA in CHANGELOG |

**Mainnet `HTLCEscrow`** will be deployed with a new `resolverRegistry` immutable
pointing to the mainnet `ResolverRegistry` at the time of deploy. Changing it
later requires a new `HTLCEscrow` deployment and a frontend migration — this is
the intended upgrade path (no proxy pattern, no upgradeable storage).

---

## 7. Future DAO / timelock path

Targeted for Q2–Q3 2027 per [`ROADMAP.md`](../ROADMAP.md) §v2.1.

### 7.1 EVM

1. Deploy an OpenZeppelin `TimelockController` with a minimum delay of 48 hours.
2. Deploy a `Governor` contract (e.g. OpenZeppelin `GovernorBravo` or equivalent)
   backed by the OverSync governance token (if issued) or a token-weighted Safe.
3. Grant `TIMELOCK_ADMIN_ROLE` and `PROPOSER_ROLE` to the Governor; grant
   `EXECUTOR_ROLE` to the zero address (anyone can execute a matured proposal).
4. Transfer `ResolverRegistry` ownership to the `TimelockController` via the
   existing Safe.
5. All future `slash`, `setMinStake`, and `setSlashBeneficiary` calls go through
   the Governor proposal → timelock queue → execution flow.

### 7.2 Stellar

Stellar's on-chain governance primitives are less composable than EVM. The
interim approach until native DAO tooling matures on Stellar:

1. Increase the Stellar multisig threshold (e.g. 3-of-5) with signers from
   the broader community.
2. Off-chain governance (Snapshot or equivalent) determines slash and
   configuration decisions; the multisig executes the on-chain transaction
   only after a governance vote passes.
3. Monitor Stellar ecosystem tooling and migrate to a native timelock or DAO
   contract when one reaches production maturity.

### 7.3 Safe retirement

When the DAO/timelock is live:
- EVM Safe calls `ResolverRegistry.transferOwnership(timelockAddress)`.
- The Governor + Timelock now own all future privileged actions.
- The Safe is de-listed from governance documentation (but retained as an
  emergency break-glass with a separate high-threshold policy TBD).

---

## 8. Public announcement checklist before any role change

Before executing any on-chain ownership or admin transfer, the following must
be completed in order:

- [ ] **Draft announcement** written and reviewed internally — includes: old
      address, new address, reason for change, effective date.
- [ ] **Community notice** posted at least 72 hours before the transaction:
      GitHub Discussions (or equivalent public forum) and Discord/Telegram.
- [ ] **CHANGELOG.md entry** merged to `master` before the on-chain
      transaction is sent (per the *"No silent admin moves"* commitment in
      [`ROADMAP.md`](../ROADMAP.md) §cross-cutting).
- [ ] **Dry-run** on testnet: execute the same transfer script against testnet
      addresses; confirm the verification script (`verify-multisig-ownership`)
      returns the expected new owner.
- [ ] **On-chain transaction** executed from the current owner/admin key or
      Safe.
- [ ] **Verification** immediately post-transaction: run
      `verify-multisig-ownership` against mainnet and confirm output matches
      the CHANGELOG entry.
- [ ] **Post-announcement** published with the transaction hash and Etherscan /
      Stellar Expert link.
- [ ] `deployments.mainnet.json` (or `deployments.testnet.json`) updated in a
      follow-up commit within 24 hours.

---

## 9. Summary table

| Contract | Current controller | Can move user funds? | Next step | Final state |
|---|---|---|---|---|
| EVM `HTLCEscrow` | None (no admin role) | No | N/A — no action needed | No admin role, immutable |
| EVM `ResolverRegistry` | Deployer EOA | No | 2-of-3 Safe (Q4 2026) | DAO Timelock (Q2–Q3 2027) |
| Soroban `HTLC` | Deployer account | No | 2-of-3 multisig (Q4 2026) | Higher-threshold community multisig |
| Soroban `ResolverRegistry` | Deployer account | No | 2-of-3 multisig (Q4 2026) | Higher-threshold community multisig |

---

*Last updated: 2026-06-28. Maintained by the OverSync core team. Open a PR
against this file to propose changes; any modification to the multisig
addresses or role schedule also requires a CHANGELOG entry.*
