# @oversync/coordinator

Reference coordinator (formerly "relayer") for the OverSync cross-chain
bridge.

## What this service does

- Hosts the public order book — anyone can POST `/api/orders/announce`
  to publish a new HTLC swap intent.
- Watches both chains for `OrderCreated` / `OrderClaimed` /
  `OrderRefunded` events and updates a persistent local cache (SQLite).
- Coordinates secret reveals between the two chains: once a preimage is
  posted to `/api/secrets/reveal`, the coordinator validates it against
  the on-chain hashlock and broadcasts it so resolvers can settle the
  counterpart side.
- Provides a `/api/orders/history?address=...` endpoint the frontend
  consumes for transaction history.

## What this service deliberately does NOT do

- Hold user funds. Ever. Every cross-chain movement is gated by
  on-chain hashlock + timelock checks.
- Sign Ethereum or Stellar transactions on behalf of users. The
  user (or a resolver) submits all chain transactions from their own
  wallet.
- Fabricate order or secret data. If the underlying chain does not
  respond, the endpoint returns the real error.

## Quick start

```bash
cd coordinator
pnpm install
pnpm dev
```

By default the coordinator listens on `:3001` and writes to
`./oversync.db`. Override with env vars (see `env.example`).

## Architecture

```
src/
├── index.ts                # 50-line bootstrap
├── config.ts               # zod-validated env config
├── logger.ts               # pino logger factory
├── server/
│   ├── app.ts              # Express app factory
│   └── routes/
│       ├── health.ts       # GET /health
│       ├── orders.ts       # POST /api/orders/announce, GET /api/orders/:id, ...
│       ├── secrets.ts      # POST /api/secrets/reveal, GET /api/secrets/:id
│       └── quotes.ts       # GET /api/quotes/eth-xlm
├── services/
│   ├── order-service.ts    # Order lifecycle + state machine guards
│   ├── secret-service.ts   # Preimage validation + storage
│   └── quote-service.ts    # CoinGecko price lookups (real, not mocked)
├── listeners/
│   ├── ethereum-listener.ts # viem event subscription
│   └── soroban-listener.ts  # Soroban getEvents polling
├── persistence/
│   ├── db.ts               # node:sqlite (Node 22.5+/24.x built-in)
│   ├── schema.sql          # idempotent schema
│   └── orders-repo.ts      # typed CRUD
└── state-machine/
    └── order-machine.ts    # legal transitions
```

This replaces the 3276-line monolithic `relayer/src/index.ts` from v1.

## Persistence

The coordinator stores order state in a local database. Two database engines are supported:

### SQLite (Local Development - Default)

We use Node's built-in `node:sqlite` driver — no native addons, no
build step. By default, the coordinator writes to `./oversync.db` in the working directory.

```bash
pnpm dev
# Writes to ./oversync.db (file:./oversync.db)
```

### PostgreSQL (Production)

For production deployments, swap the database to Postgres by setting the
`DATABASE_URL` environment variable:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/oversync pnpm start
```

The schema in `coordinator/migrations/` is applied automatically on startup.
All migrations are idempotent, so it's safe to run the coordinator against
an existing database.

## Tests

```bash
pnpm test
```

The test suite covers the order service state transitions, secret
validation (rejects preimages that don't hash to the stored hashlock),
and the schema bootstrapping on SQLite.

### Testing with PostgreSQL

To test the coordinator against a PostgreSQL database:

```bash
# Start a Postgres container (requires Docker)
docker run -d \
  --name oversync-postgres \
  -e POSTGRES_DB=oversync \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:15

# Set DATABASE_URL and run the coordinator
DATABASE_URL=postgresql://postgres:password@localhost:5432/oversync pnpm dev

# In another terminal, test an order creation
curl -X POST http://localhost:3001/api/orders/announce \
  -H "Content-Type: application/json" \
  -d '{
    "direction": "eth_to_xlm",
    "hashlock": "0x0000000000000000000000000000000000000000000000000000000000000001",
    "srcChain": "ethereum",
    "srcAddress": "0x1111111111111111111111111111111111111111",
    "srcAsset": "native",
    "srcAmount": "1000000000000000000",
    "srcSafetyDeposit": "1000000000000000",
    "dstChain": "stellar",
    "dstAddress": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB422",
    "dstAsset": "native",
    "dstAmount": "100000000"
  }'

# Cleanup
docker stop oversync-postgres && docker rm oversync-postgres
```

The schema migrations in `coordinator/migrations/` are applied automatically
on startup, making it easy to manage database versions.
