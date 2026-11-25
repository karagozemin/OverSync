# Coordinator API Error Responses

This document lists all error response shapes returned by the coordinator's HTTP API.

## Standard error envelope

All error responses share the same JSON envelope:

```json
{
  "error": "<error_code>",
  "message": "<human-readable description>"   // optional field
}
```

---

## HTTP 400 — Validation Error

Returned when the request body is syntactically valid JSON but fails schema validation.

```json
{
  "error": "validation_error",
  "details": [
    {
      "code": "invalid_type",
      "path": ["srcAmount"],
      "message": "Required"
    }
  ]
}
```

Also returned for order-level business rule violations (e.g. duplicate hashlock):

```json
{
  "error": "order_validation_error",
  "message": "Duplicate hashlock"
}
```

And for secret-related errors:

```json
{
  "error": "secret_error",
  "message": "Preimage does not match hashlock"
}
```

---

## HTTP 409 — Illegal Order Transition

Every writer (the HTTP API, the secret service, the Ethereum listener and the Soroban listener) applies order lifecycle changes through the coordinator's order state machine. An event that **skips**, **repeats** or **rewinds** a lifecycle step is refused: the stored order status is left exactly where it was, the attempt is persisted in the order's audit trail, and the caller gets `409`.

```json
{
  "error": "illegal_transition",
  "code": "illegal_transition_claim_before_secret",
  "from": "src_locked",
  "to": "completed",
  "action": "claim",
  "message": "Refused a claim for an order whose preimage has not been recorded (src_locked -> completed)"
}
```

`code` is stable and safe to switch on. The current codes:

| `code` | Meaning |
|--------|---------|
| `illegal_transition_secret_before_escrow` | A preimage was relayed for an order that is still `announced` (no source escrow yet). |
| `illegal_transition_secret_relay_before_escrow` | A destination lock arrived before the source leg was escrowed. |
| `illegal_transition_claim_before_secret` | A claim was applied before the preimage was recorded. |
| `illegal_transition_refund_after_claim` | A refund was applied to an order that was already claimed (settled). |
| `illegal_transition_late_step` | The event belongs to a lifecycle step the order has already moved past (a late/out-of-order chain event). |
| `illegal_transition_repeated_step` | The same step arrived again with an identical payload. The call is idempotent — chain listeners redeliver, so repeated steps are recorded but do not move the order and do not fail the caller. |
| `illegal_transition_conflicting_step` | The same step arrived again with a **different** payload (for example the same source lock from a different transaction). |
| `illegal_transition_already_settled` | The order is in a terminal state (`completed`, `refunded`, `failed`) and cannot be advanced again. |
| `illegal_transition_not_allowed` | Any other pair of statuses that is not a legal edge. |

The legal edges are, in lifecycle order:

```
announced       --escrow-->        src_locked
src_locked      --secret_relay-->  dst_locked
src_locked | dst_locked --secret--> secret_revealed
secret_revealed --claim-->         completed
src_locked | dst_locked | secret_revealed | expired --refund--> refunded
```

`secret_revealed -> refunded` stays legal on purpose: a source-leg timeout after the preimage became public is a real on-chain outcome, and this database is a cache of on-chain truth. The refund edge that is refused is `completed -> refunded`.

**Routes that can answer 409**

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/orders/:id/src-locked` | Source escrow |
| `POST` | `/api/orders/:id/dst-locked` | Resolver destination lock |
| `POST` | `/api/secrets/reveal` | Preimage relay (previously answered `400 secret_error`) |

### Querying refused transitions

Refused attempts are persisted per order with the code above, the writer that was refused (`order-service`, `ethereum-listener`, `soroban-listener`) and the offending transaction, so an operator can tell a late listener event apart from a client bug without reading logs.

```
GET /api/orders/:id/rejected-transitions
```

```json
{
  "status": "src_locked",
  "rejectedTransitions": [
    {
      "from": "src_locked",
      "to": "completed",
      "action": "claim",
      "code": "illegal_transition_claim_before_secret",
      "reason": "Refused a claim for an order whose preimage has not been recorded (src_locked -> completed)",
      "txHash": "0xclaim",
      "writer": "ethereum-listener",
      "timestamp": 1759180000
    }
  ]
}
```

`GET /api/orders/:id/transitions` returns the applied transition history in `transitions` and the same refused attempts in `rejectedTransitions`; refused attempts never appear in `transitions`, because they never changed the order.

The refusal count is also exported as the `coordinator_illegal_order_transitions_total{code="…"}` Prometheus counter on `/metrics`.

---

### Invalid order identifiers and history cursors

Order identifiers in order and secret routes may be 1–128 characters long.
Control characters and leading or trailing whitespace are rejected. Invalid
identifiers return HTTP 400 with `{"error":"invalid_order_id"}`.

The `cursor` query parameter for `GET /api/orders/history` has a 512-character
limit before decoding. Oversized and malformed tokens return HTTP 400 with
`{"error":"invalid_cursor","reason":"malformed","message":"Cursor is not a valid pagination token"}`.

## HTTP 404 — Not Found

```json
{ "error": "not_found" }
```

Returned when a requested order does not exist.

```json
{ "error": "not_revealed" }
```

Returned when a secret has not yet been revealed.

---

## HTTP 413 — Payload Too Large

Returned when the JSON request body exceeds the configured size limit. The limit defaults to **65,536 bytes (64 KiB)** and can be overridden with the `COORDINATOR_MAX_BODY_BYTES` environment variable.

```json
{
  "error": "payload_too_large",
  "message": "Request body exceeds the 65536-byte limit"
}
```

This check fires **before** any route business logic runs, so no partial processing occurs for oversized requests.

**Affected routes:**

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/orders/announce` | Order announcement |
| `POST` | `/api/orders/:id/src-locked` | Source-chain lock record |
| `POST` | `/api/orders/:id/dst-locked` | Destination-chain lock record |
| `POST` | `/api/secrets/reveal` | Secret preimage reveal |

---

## HTTP 500 — Internal Error

Returned for unexpected server-side errors. Stack traces are never exposed.

```json
{
  "error": "internal_error",
  "message": "<brief description>"
}
```

---

## Configuration reference

| Env var | Default | Description |
|---------|---------|-------------|
| `COORDINATOR_MAX_BODY_BYTES` | `65536` | Maximum JSON body size in bytes (64 KiB) |
