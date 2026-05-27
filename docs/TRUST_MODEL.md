# OverSync v2 — Trust Model

This document is the direct answer to the most common reviewer
concern raised against v1: *"OverSync currently relies on a single
relayer; that's a single point of failure."*

## Core invariant

User funds are locked in HTLC contracts on both chains. Each lock is
governed by:

- `hashlock` — a 32-byte commitment `H(preimage)`.
- `timelock` — an absolute timestamp `T`.
- `refundAddress` — always the original user.

The contracts enforce:

| Condition | Outcome |
|---|---|
| Some address provides `preimage` such that `H(preimage) == hashlock`, and `block.timestamp <= T` | Locked amount → `beneficiary`; safety deposit → caller. |
| `block.timestamp > T` and any address calls `refund` | Locked amount → `refundAddress` (the user); safety deposit → caller. |
| Any other condition | The contract reverts. |

No address — not the coordinator, not a resolver, not the deploying
admin — can move locked funds outside of these two paths. The relevant
source:

- [`contracts/contracts/v2/HTLCEscrow.sol`](../contracts/contracts/v2/HTLCEscrow.sol) (Ethereum side; lines 100-220 contain `claimOrder` and `refundOrder`).
- [`soroban/contracts/htlc/src/lib.rs`](../soroban/contracts/htlc/src/lib.rs) (Stellar side; functions `claim_order` and `refund_order`).

## Threat scenarios

### Coordinator compromise

If an attacker fully controls the OverSync reference coordinator —
including its database, RPC endpoints, and any keys the operator chose
to load — what can they do?

| Action | Possible? | Why |
|---|---|---|
| Steal user funds | **No** | Funds are in HTLC contracts; the coordinator holds no signing keys for those contracts. |
| Forge a fake order | **No** | Orders only become real when the user signs an on-chain `createOrder` transaction. The coordinator can publish nonsense; the user's wallet just refuses to sign. |
| Withhold the secret-reveal relay | Yes | The user observes the on-chain `OrderClaimed` event themselves and can submit the preimage on the counterpart chain manually, or wait for the timelock and refund. |
| Delete the order book | Yes | The order book is a cache; clients can rebuild it from on-chain events. |

### Resolver compromise

A resolver in OverSync is an address that has staked into the
`ResolverRegistry` and that the coordinator may route orders to. If a
single resolver is compromised:

| Action | Possible? | Mitigation |
|---|---|---|
| Steal stake of other resolvers | **No** | Stake is held in the registry contract; the registry only moves funds on `unregister` (caller's own stake) or `slash` (admin / DAO). |
| Refuse to fill orders | Yes | Other resolvers can fill. The coordinator can also serve as a fallback resolver. |
| Lock destination side then withhold the preimage | Yes, but unprofitable | The user keeps their source-side funds locked until timelock, then refunds permissionlessly. The resolver loses gas + their stake (slashable for non-completion). |

### Compromised resolver `slash` privilege

The `ResolverRegistry` exposes a `slash` function gated by
`Ownable2Step.owner`. In the v2 launch this is the deploying address
on testnet. For mainnet the design intent is:

1. Transfer ownership to a multisig (Safe or Stellar multisig
   equivalent) before launch.
2. After 30 days of stable operation, transfer ownership to a DAO
   contract with delayed execution (Timelock + Governor).
3. `slash` decisions are made via off-chain governance and executed
   through the timelock.

Until step 1 is complete the owning EOA can slash any resolver. This
is documented and the bond size is calibrated so a fraudulent slash
is bounded in damage. The owning key cannot reach user funds in the
HTLC contracts.

### Single-chain compromise

If the Ethereum side suffers a re-org or a Stellar consensus failure
mid-swap, the HTLC's `timelock` ensures eventual settlement:

- If the source side reverts and the destination side stands, the
  resolver loses the destination side until the source `refund`
  expires; the user refunds permissionlessly when their source order
  expires.
- If the destination side reverts and the source side stands, the user
  refunds the source side after the timelock; no funds are lost.

In both cases the system fails-safe: the user's funds either reach the
beneficiary or return to `refundAddress`.

## Operator-controlled assumptions

There are no operator-controlled assumptions that affect *fund
custody*. There are operator-controlled assumptions that affect
*liveness*:

1. **Coordinator uptime.** A down coordinator slows new orders but
   does not lock funds — anyone can run their own coordinator from
   the open-source code.
2. **Resolver availability.** If no resolver chooses to fill an order,
   the user's source-side funds simply remain locked until the
   timelock, then are refunded.
3. **RPC availability.** Both chains' public RPCs occasionally rate-limit
   or fail. The coordinator retries with exponential backoff and
   surfaces real errors to the frontend.

## Open questions / roadmap

- **Resolver collusion.** A coordinated group of resolvers could
  refuse to fill specific orders. Mitigation: open the resolver set
  (already done via `ResolverRegistry`) and let arbitrage incentives
  attract honest resolvers.
- **Soroban resolver registry binding.** Enforced. When a
  `ResolverRegistry` address is bound to the Soroban HTLC, every
  `create_order` performs a cross-contract `is_active(sender)` call and
  reverts with `ResolverNotAuthorised` if the sender is not an active
  staked resolver. The HTLC is correct without this check — funds are
  still locked by hashlock + timelock — but enforcement closes the
  sybil vector on the off-chain order book. `claim_order` and
  `refund_order` remain permissionless regardless of registry state.

## References

- HTLC paper foundation: [BIP 199 — OP_CHECKLOCKTIMEVERIFY](https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki) for the timelock primitive; [HTLC concept](https://en.bitcoin.it/wiki/Hash_Time_Locked_Contracts).
- 1inch Fusion+ resolver pattern: <https://blog.1inch.io/fusion-plus/>.
