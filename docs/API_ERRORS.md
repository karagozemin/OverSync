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
