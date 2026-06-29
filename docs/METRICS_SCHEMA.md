# OverSync Public Metrics Schema

This document defines the canonical schema for all publicly reported OverSync
metrics. Every metric listed here is either derivable from on-chain events,
coordinator logs, or the Prometheus `/metrics` endpoint — no proprietary
internal data is required.

**Two principles we hold without exception:**

1. A metric is only published if it is independently verifiable by any third
   party with access to the same on-chain data or open-source coordinator.
2. Testnet and mainnet numbers are never mixed in the same aggregate figure.

---

## 1. Scope and Privacy Boundaries

### 1.1 What this schema covers

All metrics described here are derived exclusively from:

- On-chain contract events (Sepolia `HTLCEscrow`, Stellar testnet
  `oversync-htlc`, their registries)
- The coordinator's SQLite order table and Prometheus counters
- Block timestamps provided by the chain

### 1.2 What this schema explicitly excludes

| Category | Reason excluded |
|---|---|
| User wallet addresses beyond what is on-chain | No PII collection |
| Secret preimages | Preimages are revealed on-chain; we do not re-publish them in off-chain logs or dashboards |
| IP addresses or browser fingerprints | No user tracking |
| Order amounts that are not already in public contract events | Swap amounts are emitted by `HTLCEscrow` and `oversync-htlc`; we surface only what the chain already makes public |
| Resolver private stake balances | Only aggregate resolver count is published |
| Coordinator internal SQLite row contents | Only aggregated counts and durations are exported |

The coordinator never logs preimages. The Prometheus `/metrics` endpoint and
any public dashboard derived from it contain only aggregate counters and
latency histograms — never per-order identifiers or addresses.

---

## 2. Network Designation

Every metric snapshot and dashboard panel carries a `network` field with one
of the following values:

| Value | Description |
|---|---|
| `testnet` | Sepolia (chain ID 11155111) + Stellar testnet passphrase `Test SDF Network ; September 2015` |
| `mainnet` | Ethereum mainnet (chain ID 1) + Stellar mainnet passphrase `Public Global Stellar Network ; September 2015` — **not yet live, reserved for post-audit launch** |

Testnet metrics are collected continuously. Mainnet metrics are reserved for
post-audit launch (Q1 2027 target). Any snapshot that omits the `network` field
is invalid and must not be published.

---

## 3. Metric Definitions

### 3.1 Successful Swaps

| Field | Value |
|---|---|
| **Metric name** | `successful_swaps` |
| **Unit** | count (integer) |
| **Source of truth** | `Claimed` events emitted by `HTLCEscrow` (Ethereum) and `claim_order` invocation records on `oversync-htlc` (Stellar), cross-referenced against coordinator order status `completed` |
| **Update cadence** | Hourly aggregation, published daily |
| **Networks** | testnet; mainnet (future) |
| **Derivation** | `SELECT COUNT(*) FROM orders WHERE status = 'completed'` on the coordinator, verified against on-chain event counts |
| **Privacy note** | Counts only; no addresses or amounts beyond what the chain already emits |

**Sub-metric — swap volume:**

| Field | Value |
|---|---|
| **Metric name** | `successful_swap_volume_usd` |
| **Unit** | USD equivalent (float, 2 decimal places), computed at swap timestamp using a public price oracle |
| **Source of truth** | `amount` field in `HTLCEscrow.OrderCreated` event, converted to USD using CoinGecko public price API at block timestamp |
| **Update cadence** | Daily |
| **Privacy note** | Amounts are already public on-chain; price conversion uses a public oracle, no user data is added |

---

### 3.2 Refund Count and Refund Latency

| Field | Value |
|---|---|
| **Metric name** | `refund_count` |
| **Unit** | count (integer) |
| **Source of truth** | `Refunded` events on `HTLCEscrow` + `refund_order` invocations on `oversync-htlc`, supplemented by coordinator order status `refunded` |
| **Update cadence** | Hourly aggregation, published daily |
| **Networks** | testnet; mainnet (future) |
| **Privacy note** | Counts only; refund destination addresses are on-chain public data, not re-published in dashboards |

| Field | Value |
|---|---|
| **Metric name** | `refund_latency_p50_seconds` / `refund_latency_p95_seconds` |
| **Unit** | seconds (integer) |
| **Source of truth** | `block.timestamp` of `OrderCreated` event subtracted from `block.timestamp` of corresponding `Refunded` event; or coordinator `created_at` vs `refunded_at` timestamps |
| **Update cadence** | Daily rolling window |
| **Networks** | testnet; mainnet (future) |
| **Alert threshold** | p95 > timelock + 1800 s (30 min) signals coordinator or resolver coordination failure (see `docs/TRACTION.md` § 6) |

---

### 3.3 Coordinator Uptime

| Field | Value |
|---|---|
| **Metric name** | `coordinator_uptime_pct_30d` |
| **Unit** | percentage (float, 1 decimal place); also expressed as total downtime minutes in the window |
| **Source of truth** | External uptime monitor (UptimeRobot or equivalent) polling the coordinator `/healthz` endpoint at 60-second intervals; secondary signal is `up{job="oversync-coordinator"}` in Prometheus |
| **Update cadence** | Real-time (uptime monitor); rolled into daily summary |
| **Networks** | testnet coordinator; mainnet coordinator (future) |
| **Privacy note** | No user data; HTTP status code and response time only |
| **SLO target (mainnet)** | ≥ 99.5% over any rolling 30-day window |

---

### 3.4 Resolver Participation Count

| Field | Value |
|---|---|
| **Metric name** | `active_resolver_count` |
| **Unit** | count (integer) |
| **Source of truth** | `ResolverRegistry.activeCount()` view function on Sepolia `HTLCEscrow` registry (`0x7D9ce70Aa4…1B6D1D99`) and `oversync-resolver-registry` on Stellar testnet |
| **Update cadence** | Daily on-chain read |
| **Networks** | testnet; mainnet (future) |
| **Derivation** | On-chain call — no off-chain database required |
| **Privacy note** | Resolver stake addresses are public on-chain; only aggregate count is published in dashboards |
| **Alert threshold (mainnet)** | < 3 active resolvers for > 24 h triggers public post-mortem per `docs/TRACTION.md` § 6 |

---

### 3.5 Average Order Lifecycle Duration

| Field | Value |
|---|---|
| **Metric name** | `order_lifecycle_duration_avg_seconds` |
| **Unit** | seconds (float) |
| **Source of truth** | Coordinator SQLite: `completed_at - created_at` for all orders with status `completed` in the measurement window |
| **Update cadence** | Daily rolling 7-day average |
| **Networks** | testnet; mainnet (future) |
| **Derivation** | `SELECT AVG(UNIXEPOCH(completed_at) - UNIXEPOCH(created_at)) FROM orders WHERE status = 'completed' AND created_at >= datetime('now', '-7 days')` |
| **Privacy note** | Duration only; no order identifiers, addresses, or amounts |

**Sub-metrics:**

| Metric name | Unit | Description |
|---|---|---|
| `order_lifecycle_duration_p50_seconds` | seconds | Median lifecycle (p50 percentile) |
| `order_lifecycle_duration_p95_seconds` | seconds | 95th-percentile lifecycle |

---

### 3.6 Failed Order Categories

| Field | Value |
|---|---|
| **Metric name** | `failed_orders_by_category` |
| **Unit** | count per category (integer) |
| **Source of truth** | Coordinator order status field + failure reason tag set by the state machine on transition to `failed` or `refunded` |
| **Update cadence** | Daily |
| **Networks** | testnet; mainnet (future) |

**Defined categories:**

| Category key | Description |
|---|---|
| `resolver_no_lock` | Resolver did not lock destination-side funds within the coordinator's lock-wait window |
| `user_no_claim` | User did not reveal the preimage before the destination-side timelock expired |
| `rpc_timeout` | RPC call to Ethereum or Stellar node failed or timed out, causing the coordinator to abort the order |
| `resolver_underfunded` | Resolver's on-chain balance was insufficient to cover the destination amount |
| `hashlock_mismatch` | Destination-side lock hashlock did not match the source-side hashlock (resolver or coordinator bug) |
| `user_cancelled` | User explicitly cancelled via the frontend refund dialog before the swap completed |
| `watchdog_refund` | Background watchdog triggered an automatic refund (XLM→ETH swap pending > 5 min) |

**Privacy note:** Categories are assigned by the coordinator state machine based
on on-chain event timing and internal state transitions. No user-identifying
information is attached to failure categories.

---

### 3.7 Contract Event Counts by Chain

| Field | Value |
|---|---|
| **Metric name** | `contract_events_by_chain` |
| **Unit** | count per event type per chain (integer) |
| **Source of truth** | On-chain event logs: Sepolia `HTLCEscrow` events via `eth_getLogs`; Stellar testnet `oversync-htlc` events via Soroban RPC `getEvents` |
| **Update cadence** | Hourly |
| **Networks** | testnet; mainnet (future) |

**Tracked events:**

| Chain | Event name | Description |
|---|---|---|
| Ethereum | `OrderCreated` | A new HTLC lock was created by a user |
| Ethereum | `OrderClaimed` | Resolver revealed the preimage and claimed ETH |
| Ethereum | `OrderRefunded` | Funds returned to the user after timelock expiry |
| Stellar | `lock_order` | HTLC lock created by a resolver on the Stellar side |
| Stellar | `claim_order` | User claimed XLM by revealing the preimage |
| Stellar | `refund_order` | XLM returned to resolver after Stellar-side timelock |

**Privacy note:** Event logs are already public on-chain. The dashboard surfaces
counts and timestamps, never preimage values, user addresses beyond what the
chain already exposes, or amounts beyond what the `OrderCreated` event emits.

---

## 4. Snapshot Format

A metrics snapshot is a point-in-time JSON document that captures the values
of all metrics above. The canonical file format is defined by the example in
`docs/examples/metrics-snapshot.example.json`.

### 4.1 Required top-level fields

| Field | Type | Description |
|---|---|---|
| `schema_version` | string | Semver of this schema document (`"1.0.0"` for this revision) |
| `snapshot_at` | ISO 8601 UTC timestamp | Moment the snapshot was produced |
| `network` | `"testnet"` or `"mainnet"` | Network this snapshot covers |
| `window_days` | integer | Rolling window in days for rate/average metrics |
| `metrics` | object | All metric values, keyed by metric name |

### 4.2 Versioning

The schema version in `schema_version` follows semver. Breaking changes (field
removals, type changes) require a major version bump. New fields are additive
and increment the minor version. Patch increments correct documentation errors
without changing field semantics.

---

## 5. Update Cadence Summary

| Cadence | Metrics |
|---|---|
| Real-time | `coordinator_uptime_pct_30d` (uptime monitor heartbeat) |
| Hourly | `contract_events_by_chain` |
| Daily | `successful_swaps`, `successful_swap_volume_usd`, `refund_count`, `refund_latency_p50_seconds`, `refund_latency_p95_seconds`, `active_resolver_count`, `failed_orders_by_category` |
| Daily rolling 7-day | `order_lifecycle_duration_avg_seconds`, `order_lifecycle_duration_p50_seconds`, `order_lifecycle_duration_p95_seconds` |

---

## 6. Relation to Existing Observability Infrastructure

The Prometheus `/metrics` endpoint served by the coordinator (see
`coordinator/ops/README.md`) exposes a subset of these metrics in real time:

| Prometheus metric | Maps to schema metric |
|---|---|
| `coordinator_orders_total{status="completed"}` | `successful_swaps` (partial — excludes on-chain event cross-check) |
| `coordinator_orders_total{status="refunded"}` | `refund_count` (partial) |
| `coordinator_listener_last_block{chain="ethereum"}` | not a public metric — internal health signal only |
| `coordinator_http_request_duration_seconds` | not published externally |

The Prometheus metrics are **internal operational signals**. The public metrics
defined in this schema are derived from them (plus on-chain data) and published
as the human-readable snapshot format described in § 4.

---

## 7. Testnet vs Mainnet Metric Availability

| Metric | Testnet (now) | Mainnet (Q1 2027+) |
|---|---|---|
| `successful_swaps` | Collected | Planned |
| `successful_swap_volume_usd` | Collected (test tokens, USD value informational only) | Planned |
| `refund_count` | Collected | Planned |
| `refund_latency_p50/p95_seconds` | Collected | Planned |
| `coordinator_uptime_pct_30d` | Collected | Planned (SLO enforced) |
| `active_resolver_count` | Collected | Planned (alert threshold enforced) |
| `order_lifecycle_duration_*` | Collected | Planned |
| `failed_orders_by_category` | Collected | Planned |
| `contract_events_by_chain` | Collected | Planned |

**Important note on testnet USD volume:** Testnet tokens have no real economic
value. `successful_swap_volume_usd` on testnet is computed purely to validate
the derivation pipeline; it must not be cited as economic traction in investor
or SCF materials.

---

## 8. References

- [`docs/TRACTION.md`](TRACTION.md) — Go-to-market plan and KPI commitments
- [`coordinator/ops/README.md`](../coordinator/ops/README.md) — Prometheus + Grafana observability stack
- [`coordinator/src/metrics.ts`](../coordinator/src/metrics.ts) — Prometheus counter/histogram definitions
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — Full system architecture including refund mechanism catalogue
- [`docs/examples/metrics-snapshot.example.json`](examples/metrics-snapshot.example.json) — Canonical JSON snapshot example
