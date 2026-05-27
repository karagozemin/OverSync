# OverSync v2 — Security

This document is the OverSync v2 threat model, audit preparation
checklist, and bug bounty plan. It deliberately calls out the things
we have NOT yet done, so any reader can verify each claim.

## Status

| Asset | Audit status | Notes |
|---|---|---|
| `soroban/contracts/htlc` | **Unaudited.** Has 10 unit tests. | Slated for independent audit pre-mainnet (Tranche 2 deliverable). |
| `soroban/contracts/resolver-registry` | **Unaudited.** | Same plan as above. |
| `contracts/v2/HTLCEscrow.sol` | **Unaudited.** 15 Hardhat tests + slither lint in CI. | Audit prep includes Foundry fuzz + invariant suite (Tranche 1 deliverable). |
| `contracts/v2/ResolverRegistry.sol` | **Unaudited.** 6 Hardhat tests. | Owner role intended for multisig before mainnet. |
| Coordinator + SDK + frontend | Out of scope for security audit — they cannot move user funds (see [`TRUST_MODEL.md`](TRUST_MODEL.md)). | Static analysis (eslint + tsc strict) only. |

## Threat model

We use a STRIDE-style breakdown.

### Spoofing

| Threat | Mitigation |
|---|---|
| Attacker impersonates the coordinator API to phish users | Coordinator URL is hardcoded in the frontend bundle; users are educated to verify the published `oversync.app` domain. |
| Attacker impersonates a resolver | Resolvers are identified by their on-chain stake in the registry; a non-staked address simply cannot be matched against `isActive`. |

### Tampering

| Threat | Mitigation |
|---|---|
| Coordinator DB is corrupted | DB is a cache; it can be rebuilt from on-chain events. No user funds depend on it. |
| Frontend bundle is replaced via DNS hijack | Standard mitigation: CSP, SRI on critical assets, build provenance via GitHub releases. |

### Repudiation

All state-changing actions on the bridge happen via signed on-chain
transactions visible on either Etherscan or Stellar Expert.

### Information disclosure

The bridge does not handle PII. Order metadata (addresses, amounts,
hashlocks) is public on-chain by design.

### Denial of service

| Threat | Mitigation |
|---|---|
| Coordinator DDoS | Rate-limit + Cloudflare in front of the public deployment. Even with the coordinator offline, users can still refund directly from contracts. |
| Resolver collusion to ignore an order | Anyone can run a resolver; users can also self-resolve by participating as their own resolver. |
| Public RPC rate-limits during high traffic | Multiple Alchemy / QuickNode endpoints in a round-robin pool. |

### Elevation of privilege

| Threat | Mitigation |
|---|---|
| Admin can drain HTLC contracts | The HTLC contract has **no** admin role with fund-moving authority (no `emergencyWithdraw`, no `pause`, no `transferOwnership`). Verified in the test `non-custodial guarantees > contract has no admin escape hatch`. |
| Registry admin can drain resolver stakes outside of slashing | `slash` is the only privileged action and it routes funds to `slashBeneficiary`, not to the admin EOA. |

## Audit preparation checklist

Pre-audit (Tranche 1):

- [x] Single canonical EVM HTLC contract (`HTLCEscrow.sol`)
- [x] Single canonical Soroban HTLC contract (`oversync-htlc`)
- [x] No admin escape hatches in HTLC contracts
- [x] Reentrancy guards on every state-changing function (OZ `ReentrancyGuard`)
- [x] `SafeERC20` on every token transfer
- [x] OpenZeppelin v5 used (`Ownable2Step` for the registry)
- [x] 10 Soroban unit tests + 21 Hardhat unit tests in CI
- [x] Foundry fuzz + invariant tests (`contracts/test/foundry/HTLCEscrow.t.sol`, gated in CI)
- [ ] Slither must-not-fail CI gate (currently advisory)
- [ ] Differential testing: same hashlock works on both chains

Audit (Tranche 2):

- [ ] Engage two independent auditors for the HTLC contracts
- [ ] Public audit reports + remediation diff
- [ ] Bug bounty announced

## Bug bounty

We will open a public Immunefi-style bounty once both HTLC contracts
are audited. Until then, please email security findings to
`security@oversync.app` (PGP key to be published). We commit to:

- Acknowledging within 48h.
- Crediting reporters on the SECURITY.md release notes (unless they
  prefer anonymity).
- Not pursuing legal action against good-faith security research that
  follows responsible disclosure.

## Out of scope for v2

- Optimistic rollup support
- Native Bitcoin support
- Off-chain MEV mitigation beyond hashlock + timelock semantics
