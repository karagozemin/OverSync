# Incident Response Runbook

## Purpose

Provide structured procedures for responding to operational incidents affecting the OverSync bridge. This runbook covers detection, diagnosis, containment, recovery, and postmortem for coordinator, resolver, RPC, contract, and frontend incidents. It does not cover every possible failure mode — see [`ARCHITECTURE.md § 9`](../ARCHITECTURE.md#9-failure-mode-catalogue) for the exhaustive failure catalogue.

---

## Incident Severity

| Severity | Label | Description |
|---|---|---|
| SEV-4 | Service Degraded | Non-critical component slow or partially unavailable. No user orders affected. Example: frontend metrics endpoint unreachable, Grafana dashboard unresponsive. |
| SEV-3 | Partial Outage | One component unable to serve a subset of requests. Some order creation or event ingestion affected, but no fund safety risk. Example: Soroban listener stalled, coordinator health endpoint still returning 200. |
| SEV-2 | Complete Outage | Core bridge component fully unavailable. Order creation and event ingestion halted. Users cannot initiate or track swaps through normal paths. Example: coordinator process crashed, all listeners down. |
| SEV-1 | Funds Potentially at Risk | Suspected smart contract bug, anomalous on-chain activity, or unauthorised access path. Requires immediate containment and verification even if unconfirmed. This severity is reserved for scenarios where the on-chain HTLC invariants may be violated. |

**Separation of concerns:** SEV-1 covers fund safety. SEV-2 through SEV-4 cover operational availability. No operational incident automatically escalates to SEV-1 unless there is evidence of contract-level compromise.

---

## Response Timeline

### First 15 Minutes

1. **Acknowledge** — Confirm the alert in the designated incident channel.
2. **Identify scope** — Determine which component(s) are affected (coordinator, resolver, RPC, frontend, contracts). Check the coordinator `/health` endpoint.
3. **Assign incident owner** — One person drives the response; others support.
4. **Collect logs/metrics** — Pull coordinator logs, check Prometheus targets at `:9090`, review Grafana dashboard panels (Orders by Status, Listener Last Block, HTTP latency).
5. **Verify bridge state** — Check both HTLC contracts on-chain via Etherscan / Stellar Expert. Confirm recent `OrderCreated`, `OrderClaimed`, `OrderRefunded` events exist within expected time bounds.
6. **Determine whether user funds are affected** — If the incident involves an on-chain component, verify the `refundAddress` invariant holds. If this check fails, escalate to SEV-1.

### First Hour

1. **Isolate affected services** — If the coordinator is serving bad data or is under attack, stop it or restrict access. Do not restart a crashed service without first collecting crash logs.
2. **Communicate status** — Post a brief status update on the status page. Use the templates in [User Communication](#user-communication).
3. **Verify refunds** — For any in-flight orders that may be affected, confirm that the on-chain HTLC refund path is available (`block.timestamp > timelock`, `refundOrder` / `refund_order` callable). Reference [`ARCHITECTURE.md § 6`](../ARCHITECTURE.md#6-refund-mechanisms).
4. **Evaluate rollback** — See [Frontend Rollback](#frontend-rollback) and [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for contract redeployment guidance.
5. **Begin root cause analysis** — Collect event timelines, correlate with deployment or configuration changes.

### First Day

1. **Restore normal service** — Apply the fix identified during root cause analysis. Verify the fix on testnet first where applicable.
2. **Verify recovery** — Confirm coordinator `/health` returns `status: ok`. Confirm listener last block advances. Confirm a test order can be created and tracked end-to-end.
3. **Publish updates** — Update status page to resolved. Post a summary in the incident channel.
4. **Prepare postmortem** — Draft the postmortem using the [Postmortem Template](#postmortem-template). Include timeline, root cause, user impact, and preventive actions.
5. **Identify follow-up actions** — File issues for any code changes, configuration fixes, or monitoring gaps discovered.

---

## Coordinator Outage

### Symptoms

- Coordinator `/health` returns non-200 or does not respond.
- Prometheus `up{job="oversync-coordinator"}` == 0 for > 2 minutes (alert configured in `coordinator/ops/README.md`).
- Frontend order creation fails with connection errors.
- `coordinator_listener_last_block` metric stops advancing.

### Impact

- Users cannot create new orders through the frontend or coordinator API.
- Resolvers cannot poll the coordinator order book for new fill opportunities.
- In-flight orders are **unaffected** — the HTLC contracts on both chains continue to function. Users can still claim or refund directly from their wallets.
- The refund watchdog (if running in the relayer process) continues scanning independently.

### Diagnosis

1. Check the coordinator process status: `curl http://<coordinator>:3001/health`.
2. Review coordinator logs (pino JSON output) for crash indicators, OOM errors, or unhandled rejections.
3. Check Prometheus target status at `http://<prometheus>:9090/targets`.
4. Verify the database connection (SQLite file path or Postgres `DATABASE_URL`).
5. Confirm the RPC endpoints are reachable from the coordinator host.

### Recovery

1. Restart the coordinator process: `pnpm start` or container restart.
2. Verify the database is not corrupted. SQLite corruption manifests as `SQLITE_CORRUPT` errors on startup; restore from the last backup or rebuild from on-chain events.
3. Confirm listeners resume by checking `coordinator_listener_last_block` advances for both chains.
4. If the database cannot be recovered, the coordinator will rebuild its order cache from on-chain events. This may take several minutes depending on how many events must be replayed.
5. If the coordinator was killed by OOM, increase available memory or reduce the poll concurrency (`COORDINATOR_POLL_INTERVAL_MS`).

---

## Resolver Outage

### Symptoms

- A resolver's Stellar or Ethereum address has not submitted any transactions for > 30 minutes.
- The coordinator order book shows orders in `Locked` status with no destination-side fill.
- Resolver health endpoint (if the resolver exposes one) is unreachable.

### Impact

- Orders assigned to that resolver may stall. The coordinator may reassign unfulfilled orders to other resolvers if the order book supports it.
- If no resolver fills a given order, the user's source-side funds remain locked until the timelock expires, then refund permissionlessly via the on-chain HTLC refund.
- Other resolvers and the coordinator's own fallback resolver are unaffected.

### Recovery Guidance

1. Check whether the resolver runner process is alive (Docker container status, process list, logs).
2. Verify resolver credentials: `RESOLVER_ETH_PRIVATE_KEY` and `RESOLVER_STELLAR_SECRET` are correct and the accounts have sufficient gas / XLM balance.
3. Confirm the resolver's stake is still active in the `ResolverRegistry` — call `isActive(resolverAddress)` on-chain.
4. If the resolver process crashed, restart it. If it was slashed, the operator must re-register (see [`docs/RESOLVERS.md`](RESOLVERS.md)).
5. If the resolver has insufficient gas on Ethereum or insufficient XLM for Soroban fees, replenish and restart.

### Refund Considerations

If a resolver outage leaves orders in a partially-filled state across testnet or a future deployment:

- **ETH locked, XLM not locked:** User calls `refundOrder` on `HTLCEscrow` after `timelock_eth` expires.
- **XLM locked (v1 path), ETH not released:** The automatic XLM refund (layer 6.3) or background watchdog (layer 6.4) should trigger. If neither fires, the Stellar-side order falls through to the Soroban `refund_order` after `timelock_xlm`.
- In v2 Soroban HTLC deployments, both directions have on-chain HTLC refunds — see [`ARCHITECTURE.md § 6.1`](../ARCHITECTURE.md#61-on-chain-htlc-refund-primary).

---

## RPC Degradation

### Symptoms

- `coordinator_listener_last_block` not advancing for one or both chains.
- Coordinator logs show `queryFilter` errors, rate-limit responses, or timeouts.
- `COORDINATOR_RPC_TIMEOUT_MS` (default 8000ms) exceeded repeatedly.
- Prometheus HTTP p95 latency > 500ms on coordinator routes that depend on RPC calls.

### Impact

- Event ingestion stalls for the affected chain. The coordinator cannot update order state from on-chain events.
- Order creation and tracking may return stale or incomplete data.
- In-flight orders are unaffected — the HTLC contracts remain functional. Claim and refund transactions submitted directly to the chain via the user's wallet still work.

### Retry Behavior

Both listeners use stateless polling (`queryFilter` / `getEvents`), not stateful subscriptions. The cursor (`lastProcessedBlock`) advances only on successful queries. Transient failures automatically retry on the next poll tick. See [`ARCHITECTURE.md § 8.3`](../ARCHITECTURE.md#83-rpc-requirements).

The coordinator configures RPC timeouts via `COORDINATOR_RPC_TIMEOUT_MS` (env var). All RPC calls have timeouts — a hung RPC cannot lock the request thread indefinitely.

### Monitoring

- **Prometheus `coordinator_listener_last_block{chain="ethereum"}`** — should increase every ~12 seconds on Sepolia.
- **Prometheus `coordinator_listener_last_block{chain="soroban"}`** — should increase every ~5 seconds on Stellar testnet.
- Alert if either metric has not advanced for > 2 minutes (see `coordinator/ops/README.md` for the `ListenerStale` alert).

### Failover Guidance

The coordinator resolves RPC endpoints in the following order (see `env.example`):

1. Explicit `SEPOLIA_RPC_URL` / `MAINNET_RPC_URL`
2. `INFURA_API_KEY` — constructs the full URL
3. Public fallback (PublicNode, etc.)

For production, Infura is recommended. If rate-limited, rotate the API key or add a round-robin pool with multiple endpoints (Alchemy, QuickNode, etc. — see [`docs/SECURITY.md`](SECURITY.md) § Denial of service). The coordinator does not currently support automatic RPC failover between providers; a configuration change and restart are required.

---

## Stuck Order Reports

### How to Verify Order State

1. Ask the user for their order ID (returned by `POST /api/orders/announce`) or their wallet address.
2. Look up the order in the coordinator: `GET /api/orders/:id` or `GET /api/orders/history?address=...`.
3. Cross-reference the on-chain state:
   - **Ethereum side:** Call `HTLCEscrow.orders(orderId)` view function on Etherscan. Check `status` (0 = Locked, 1 = Claimed, 2 = Refunded).
   - **Stellar side (Soroban):** Use Stellar Expert contract read or `stellar contract invoke` to call `order(id)`.
4. Compare the on-chain `status` with the coordinator's recorded `status`. If they disagree, the coordinator's cache is stale — trust the on-chain state.

### How to Determine Whether HTLC Refunds Apply

- If `block.timestamp > timelock` and the on-chain status is `Locked` (0), the order is eligible for refund.
- **Ethereum:** Anyone can call `HTLCEscrow.refundOrder(orderId)`. The locked amount goes to `refundAddress`; the safety deposit goes to the caller.
- **Stellar:** Anyone can call `oversync-htlc::refund_order(env, order_id)`. Same delivery logic.
- If the order status is already `Claimed` or `Refunded` on-chain, no further action is needed.

See [`ARCHITECTURE.md § 6.1`](../ARCHITECTURE.md#61-on-chain-htlc-refund-primary) and [`ARCHITECTURE.md § 6.2`](../ARCHITECTURE.md#62-frontend-refund-dialog-ux-layer).

### What Information Users Should Provide

When reporting a stuck order, ask for:

- Order ID (from the coordinator response or transaction history).
- Source chain transaction hash (Etherscan or Stellar Expert link).
- Destination chain transaction hash (if any).
- Wallet address used.
- Timestamp of the swap attempt.

---

## Suspected Contract Bug

### Immediate Containment

1. **Do not deploy a new contract yet.** Verify first.
2. Stop the coordinator so no new orders are created through the reference deployment. This prevents additional user funds from being locked while the situation is assessed.
3. If the frontend is publicly deployed, consider whether to disable it (see [Frontend Rollback](#frontend-rollback)).

### Disabling Affected Flows

- The coordinator being offline does not prevent users from claiming or refunding existing orders — those are permissionless on-chain operations.
- If the bug is specific to one direction (e.g. ETH→XLM or XLM→ETH), and the coordinator supports directional gating, disable only the affected direction.
- On the frontend, if a hotfix deploy is faster than a coordinator change, update the UI to hide the affected direction (see `VITE_MAINNET_ENABLED` pattern in `frontend/src/config/networks.ts`).

### Verification Steps

1. Reproduce the suspected bug against the testnet deployment. Write a test case that demonstrates the invariant violation.
2. Review the relevant contract source:
   - `contracts/contracts/v2/HTLCEscrow.sol` — `claimOrder` and `refundOrder` require statements.
   - `soroban/contracts/htlc/src/lib.rs` — `claim_order` and `refund_order` require statements.
3. Verify no admin escape hatch exists (no `onlyOwner` on any fund-moving function). See [`ARCHITECTURE.md § 13.1`](../ARCHITECTURE.md#131-solidity-contractscontractsv2).
4. If the bug is confirmed, escalate to the security contact.

### Escalation Guidance

If a contract bug is confirmed or strongly suspected:

1. **Do not post exploit details publicly.**
2. Email `security@oversync.app` with the reproduction case (see [`docs/SECURITY.md`](SECURITY.md)).
3. If user funds are at immediate risk, consider whether a social recovery announcement is warranted (contact users to refund by deadline — the contracts have no kill switch, so the only recovery is the timelock-based refund path described in [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) § Rolling back).

---

## Frontend Rollback

### Rollback Triggers

Roll back the frontend deployment when:

- The frontend displays incorrect order state or misleading balances.
- A frontend change breaks the swap flow (e.g. incorrect contract address, wrong RPC URL).
- The frontend exposes internal data that was not meant for production (console output, source maps).
- A contract address or API base URL needs to be reverted.

### Deployment Verification

1. Confirm the previous working version in Vercel deployment history.
2. Trigger a rollback via the Vercel dashboard or CLI: `vercel rollback`.
3. Verify the rollback completes by checking the Vercel deployment status.

### Post-Rollback Validation

1. Confirm the homepage loads without console errors (use browser devtools).
2. Verify network mode: testnet-only if `VITE_MAINNET_ENABLED=false` (default). The navbar should show **Testnet** active and **Mainnet Coming** disabled.
3. Create a test order on testnet and track it through completion.
4. Verify the refund dialog appears for a locked order past timelock.
5. Check `?network=mainnet` in the URL is rewritten to `testnet` (when `VITE_MAINNET_ENABLED=false`).

---

## User Communication

### Investigating

> We are investigating a report affecting [component]. Users may experience [symptom]. Existing in-flight orders are not affected — refund paths remain available. We will provide an update within [timeframe].

### Service Degradation (SEV-4)

> [Component] is currently experiencing degraded performance. Order creation may be slower than usual. All existing orders are safe. We are working on restoring normal service.

### Partial Outage (SEV-3)

> [Component] is experiencing a partial outage affecting [specific functionality]. Users may not be able to [create orders / track orders / view history]. Fund safety is not affected — locked funds can still be claimed or refunded on-chain. We are investigating and will update within [timeframe].

### Complete Outage (SEV-2)

> [Component] is currently unavailable. New order creation is paused. All existing in-flight orders are safe — users can claim or refund directly from the HTLC contracts on-chain. We are working to restore service and will provide an update within [timeframe].

### Incident Resolved

> The incident affecting [component] has been resolved. Normal service has been restored. No user funds were affected. A postmortem will be published within [timeframe]. If you experienced issues during this period, please contact us with your order ID and we will review.

---

## Postmortem Template

```markdown
# Postmortem: [Title]

## Summary
Brief description of the incident, including duration and user impact.

## Timeline
- `HH:MM` — Alert triggered: [description]
- `HH:MM` — Incident acknowledged
- `HH:MM` — Scope identified
- `HH:MM` — Containment action taken
- `HH:MM` — Fix applied
- `HH:MM` — Service restored

All timestamps in UTC.

## Root Cause
What caused the incident. Include specific component, configuration, or code path.

## User Impact
- Orders affected: [count]
- Users affected: [count]
- Duration of impact: [X minutes/hours]

## Funds Impact
- Funds at risk: [none / amount if known]
- Refunds issued: [yes/no — if yes, describe mechanism]
- On-chain verification: [link to relevant transactions or contracts]

## Resolution
What was done to restore service. Include specific commands, configuration changes, or code changes.

## Preventive Actions
- [ ] Monitoring gap identified: [description]
- [ ] Test gap identified: [description]
- [ ] Documentation gap identified: [description]
- [ ] Configuration hardened: [description]

## Owners
- Incident owner: [name]
- Responders: [names]
- Postmortem author: [name]

## Follow-up Tasks
- [ ] [Task description] — [owner] — [target date]
- [ ] [Task description] — [owner] — [target date]
```
