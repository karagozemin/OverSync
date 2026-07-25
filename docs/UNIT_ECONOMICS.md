# OverSync Unit Economics

This document is a working model for resolver incentives and bridge
sustainability. It is intentionally conservative: it should help SCF
reviewers, resolver operators, and investors understand the variables
that matter, not claim profitability before OverSync has enough live
mainnet data.

Every numeric assumption below is marked as:

- **measured** - observed from the current repo, deployment config, or
  chain mechanics.
- **estimated** - reasonable planning estimate that must be validated
  during testnet/beta.
- **placeholder** - a value used only to show break-even math.

Resolver onboarding lives in [`docs/RESOLVERS.md`](RESOLVERS.md).
Current coordinator metrics are exposed through
[`coordinator/src/server/routes/metrics.ts`](../coordinator/src/server/routes/metrics.ts)
and defined in [`coordinator/src/metrics.ts`](../coordinator/src/metrics.ts).
Order and resolver heartbeat fields are defined in
[`coordinator/src/persistence/schema.sql`](../coordinator/src/persistence/schema.sql).

## 1. Economic Roles

OverSync has two different funding phases:

| Phase | Funding source | Purpose | Sustainability claim |
|---|---|---|---|
| Bootstrap | Grants, testnet incentives, internal liquidity budget | Pay for resolver learning, infra, testnet liquidity, failed-fill drills, and public metrics collection | Not sustainable by itself |
| Market | User-visible swap fee, resolver spread, optional protocol fee | Pay resolvers for capital, gas, operations, and risk once real demand exists | Sustainable only if measured fee revenue exceeds measured resolver cost |

Grant-funded bootstrap should be accounted for separately from market
fees. A grant can prove the network can operate; it does not prove that
the network is profitable.

## 2. Resolver Cost Categories

| Cost category | What it covers | Cost behavior | Current source |
|---|---|---|---|
| RPC | Ethereum RPC, Soroban RPC, archival lookups, retry headroom | Mostly fixed until volume forces higher tiers | `INFURA_API_KEY`, `SEPOLIA_RPC_URL`, and `SOROBAN_RPC_URL` in [`env.example`](../env.example) |
| Infra | VPS/container hosting, logs, metrics, alerting, database backups | Mostly fixed | Resolver runner in [`resolver/`](../resolver/) and coordinator ops in [`coordinator/ops/`](../coordinator/ops/) |
| Capital float | Inventory held on both chains while orders settle | Variable with average order size, settlement time, and capital cost | Resolver inventory policy, not yet encoded in metrics |
| Failed-fill risk | Gas spent on orders that refund, destination liquidity temporarily locked, slash exposure for misbehavior | Variable with failure rate and order size | Failure states in [`coordinator/src/persistence/schema.sql`](../coordinator/src/persistence/schema.sql) |
| Ops time | Key rotation, upgrades, monitoring, incident response, accounting | Mostly fixed at low volume, stepwise as volume grows | Operational checklist in [`docs/RESOLVERS.md`](RESOLVERS.md) |

## 3. Revenue Assumptions

| Revenue line | Description | Bootstrap treatment | Sustainable treatment |
|---|---|---|---|
| Swap fee | Explicit fee paid by the user or embedded in the quote | May be `0 bps` (**placeholder**) to reduce testnet friction | Must cover variable cost plus a share of fixed cost |
| Spread | Difference between source-side value and destination-side fill amount | May be capped or reimbursed by incentives | Resolver-owned pricing lever; must be transparent in quotes |
| Incentive pool | Temporary reward per successful fill or active resolver | Grant-funded and time-limited | Should taper down as market fees grow |
| Bootstrap grants | SCF or ecosystem grants funding development and testnet operations | Valid for cold start | Must not be counted as recurring resolver margin |

For modeling:

```text
revenue_per_order =
  swap_fee_bps * average_order_size
  + spread_bps * average_order_size
  + bootstrap_incentive_per_order

cost_per_order =
  evm_gas_cost
  + stellar_fee_cost
  + infra_per_order
  + capital_float_cost
  + failed_fill_loss_reserve

break_even_orders_per_month =
  monthly_fixed_cost / max(revenue_per_order - variable_cost_per_order, 0)
```

## 4. Baseline Assumptions

These are planning inputs, not performance claims.

| Variable | Conservative model | Optimistic model | Label |
|---|---:|---:|---|
| Completed orders per month | `2,000` | `20,000` | placeholder |
| Average order size | `$150` | `$300` | placeholder |
| Resolver swap fee | `20 bps` | `30 bps` | placeholder |
| Resolver spread | `5 bps` | `8 bps` | placeholder |
| Bootstrap incentive | `$0.00/order` after grants end | `$0.00/order` after grants end | placeholder |
| Ethereum gas per resolver-side action | `$4.00` | `$1.25` | estimated |
| Stellar fee per resolver-side action | `$0.01` | `$0.01` | estimated |
| RPC + infra fixed cost | `$350/month` | `$600/month` | estimated |
| Ops allocation | `$1,000/month` | `$2,000/month` | estimated |
| Failed-fill reserve | `0.30%` of filled value | `0.05%` of filled value | placeholder |
| Capital cost | `12% APR` on average in-flight inventory | `8% APR` on average in-flight inventory | placeholder |
| Average capital lock time | `6 hours` | `2 hours` | placeholder |

The model treats safety deposits and registry stake as capital at risk,
not revenue. Current deployment instructions show an example
`V2_MIN_STAKE=100000000000000000000`, described as `100 tokens`
(**measured from docs**, token value depends on the stake asset), and
`V2_MIN_SAFETY_DEPOSIT=0` (**measured from docs**, testnet example).
Mainnet values should be recalibrated after live failure-rate data.

## 5. Break-Even Examples

### Testnet

| Item | Value |
|---|---:|
| Completed orders | `500/month` (**placeholder**) |
| Average order size | `$25` (**placeholder**) |
| Market fee + spread | `$0.00/order` (**placeholder**) |
| Bootstrap incentive pool | `$300/month` (**placeholder**) |
| RPC + infra + ops | `$250/month` (**estimated**) |
| Variable chain costs | `$0.05/order` (**estimated**, testnet/faucet conditions) |
| Result | Grant-funded learning environment, not sustainable market economics |

Testnet should measure order completion, refund behavior, resolver
uptime, and operational cost. It should not be presented as proof that
mainnet resolvers can earn margin.

### Beta

| Item | Conservative | Optimistic |
|---|---:|---:|
| Completed orders | `2,000/month` (**placeholder**) | `5,000/month` (**placeholder**) |
| Average order size | `$150` (**placeholder**) | `$200` (**placeholder**) |
| Fee + spread | `25 bps` (**placeholder**) | `35 bps` (**placeholder**) |
| Market revenue per order | `$0.375` (**placeholder math**) | `$0.700` (**placeholder math**) |
| Bootstrap incentive | `$0.50/order` (**placeholder**) | `$0.25/order` (**placeholder**) |
| Variable cost per order | `$4.46` (**estimated/placeholder mix**) | `$2.18` (**estimated/placeholder mix**) |
| Fixed cost | `$1,350/month` (**estimated**) | `$1,800/month` (**estimated**) |
| Result | Requires grants or fee changes | Still likely needs incentives unless gas is low or order size rises |

Beta is the right phase to tune fees, minimum order size, resolver
selection, and failed-fill controls. Bootstrap rewards are acceptable
here, but they should be reported as subsidies.

### Mainnet

| Item | Conservative | Optimistic |
|---|---:|---:|
| Completed orders | `2,000/month` (**placeholder**) | `20,000/month` (**placeholder**) |
| Average order size | `$150` (**placeholder**) | `$300` (**placeholder**) |
| Fee + spread | `25 bps` (**placeholder**) | `38 bps` (**placeholder**) |
| Market revenue per order | `$0.375` (**placeholder math**) | `$1.140` (**placeholder math**) |
| Variable cost per order | `$4.46` (**estimated/placeholder mix**) | `$1.41` (**estimated/placeholder mix**) |
| Fixed cost | `$1,350/month` (**estimated**) | `$2,600/month` (**estimated**) |
| Monthly operating result before grants | Negative under these assumptions | Near break-even only if gas, failures, and ops stay low |

Under the conservative model, the market fee is not enough. The bridge
would need some combination of higher average order size, higher fees,
lower gas, batching/route optimization, tighter failure controls, or
temporary incentives. Under the optimistic model, sustainability is
possible but not proven; it depends on measured order volume and
measured resolver costs.

## 6. Sensitivity Table

The table below shows directional impact on resolver margin per order.
All values are scenario inputs, not observed OverSync production data.

| Driver | Conservative input | Optimistic input | Margin impact |
|---|---:|---:|---|
| Ethereum gas per resolver-side action | `$8.00` (**placeholder**) | `$0.75` (**placeholder**) | High; can dominate small orders |
| Stellar fees per resolver-side action | `$0.02` (**placeholder**) | `$0.005` (**placeholder**) | Low today, but should still be measured |
| Completed order volume | `2,000/month` (**placeholder**) | `20,000/month` (**placeholder**) | High for fixed-cost absorption |
| Average order size | `$100` (**placeholder**) | `$1,000` (**placeholder**) | High; bps fees work better on larger orders |
| Failed-fill rate | `1.00%` (**placeholder**) | `0.05%` (**placeholder**) | High; failed fills consume gas and liquidity |
| Average lock time | `12 hours` (**placeholder**) | `1 hour` (**placeholder**) | Medium; affects capital float and inventory needs |
| Active resolver count | `3` (**placeholder**) | `10` (**placeholder**) | Mixed; improves liveness but splits flow |
| Fee + spread | `20 bps` (**placeholder**) | `50 bps` (**placeholder**) | High; must remain competitive with alternatives |

## 7. Metrics Needed Before Stronger Claims

The current metrics endpoint provides process and coordinator-level
basics: order counters by status, listener block height, HTTP latency,
and default Node.js metrics. To make stronger economic claims, OverSync
needs a resolver economics metrics schema that records at least:

| Metric | Why it matters | Suggested source |
|---|---|---|
| Completed order count by resolver, direction, asset, and size bucket | Measures actual fill volume and resolver competition | Extend `coordinator_orders_total` labels or add resolver-specific counters |
| Resolver gas paid per claim/refund/create transaction | Converts chain activity into unit cost | Resolver runner transaction receipts |
| Stellar transaction fee paid per order | Measures non-EVM settlement cost | Soroban submission receipts |
| Quote fee, spread, and effective user price | Separates user-paid fees from incentives | Quote service and order rows |
| Bootstrap reward paid per resolver/order | Keeps grants separate from sustainable fees | Incentive pool ledger |
| Failed-fill and refund rate by failure reason | Prices risk reserve and slash policy | Order state transitions in `order_events` |
| Capital lock duration per order | Prices inventory float | Difference between source lock, destination lock, claim, and refund timestamps |
| Resolver uptime and missed-order rate | Determines whether incentives buy reliable service | `resolver_heartbeats` plus listener events |

Until those metrics are collected from live beta/mainnet traffic, the
right claim is: OverSync has a plausible path to resolver
sustainability if market fees and spreads cover measured costs at
meaningful order volume. It should not claim resolver profitability.

## 8. Operating Guardrails

- Publish grant spend and incentive-pool rewards separately from market
  fee revenue.
- Do not count testnet faucet assets as liquidity revenue.
- Do not quote a resolver APR until stake value, fill volume, failed
  fills, and fee revenue are measured over a meaningful window.
- Recalculate minimum order size whenever gas, RPC tier, or failure
  rate changes materially.
- Keep safety deposits and slashable stake sized for behavior control,
  not as a hidden profit center.
- Report flat or negative economics plainly; the roadmap already
  commits to real metrics only in [`ROADMAP.md`](../ROADMAP.md) and
  [`docs/TRACTION.md`](TRACTION.md).
