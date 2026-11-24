# WebSocket Subscription Limits

## Overview

The WebSocket server enforces a per-connection subscription limit to prevent a single client from consuming unbounded memory by creating excessive subscriptions.

## Configuration

The subscription limit can be configured via environment variable:

```bash
WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION=1000
```

**Default:** 1000 subscriptions per connection

## What Counts as a Subscription

The limit applies to the total count of:

1. **Event subscriptions** - Each event type (e.g., `order_created`, `order_filled`)
2. **Order filters** - Each specific order hash being tracked
3. **Resolver filters** - Each resolver address being tracked
4. **Chain filters** - Each chain ID being tracked

### Example

If a client subscribes to:
- 5 event types
- 10 specific order hashes
- 3 resolver addresses
- 2 chain IDs

The total subscription count is: **20**

## Behavior

### Subscription Request

When a client attempts to subscribe:

1. The server calculates how many **new** subscriptions would be added (duplicates don't count)
2. If the total would exceed the limit, the request is rejected with error code `-32000`
3. If within the limit, the subscription succeeds

### Successful Subscription Response

```json
{
  "id": "1",
  "result": {
    "subscribed": true,
    "events": ["order_created", "order_filled"],
    "filters": {
      "orders": ["0xabc..."],
      "resolvers": ["0x123..."],
      "chains": [1, 11155111]
    },
    "subscriptionCount": 42,
    "limit": 1000
  }
}
```

### Rejected Subscription Response

```json
{
  "error": {
    "code": -32000,
    "message": "Subscription limit exceeded",
    "data": {
      "current": 950,
      "requested": 100,
      "limit": 1000,
      "message": "Cannot add 100 subscription(s). Current: 950, Limit: 1000"
    }
  }
}
```

### Unsubscribe

When a client unsubscribes, the subscription slots are immediately released:

```json
{
  "id": "2",
  "result": {
    "unsubscribed": true,
    "removed": 10,
    "subscriptionCount": 32,
    "limit": 1000
  }
}
```

### Disconnect

When a client disconnects, all subscription slots are automatically released. The server logs the number of released subscriptions:

```
🔌 Client abc-123 disconnected: released 42 subscription(s)
```

## Monitoring

Subscription counts are logged when clients subscribe, unsubscribe, or disconnect:

```
📡 Client abc-123 subscribed: count=42/1000
📡 Client abc-123 unsubscribed: removed=10, count=32/1000
🔌 Client abc-123 disconnected: released 32 subscription(s)
```

When a limit is exceeded:

```
⚠️ Client abc-123 exceeded subscription limit: current=950, requested=100, limit=1000
```

## Best Practices

### For Clients

1. **Start specific, expand if needed** - Don't subscribe to all possible events upfront
2. **Unsubscribe when done** - Release slots you're no longer using
3. **Handle limit errors gracefully** - Implement retry logic with backoff
4. **Monitor your count** - Track `subscriptionCount` in responses to stay aware of usage

### For Operators

1. **Set appropriate limits** - Balance memory usage vs. client needs
2. **Monitor logs** - Watch for clients hitting limits frequently
3. **Adjust based on usage** - Tune the limit based on observed patterns

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32000 | Subscription limit exceeded | Client attempted to exceed per-connection subscription limit |

## Implementation Details

- Duplicate subscriptions don't count toward the limit
- Subscriptions are tracked per WebSocket connection
- Limits are enforced at subscription time (not connection time)
- Counter is decremented immediately on unsubscribe or disconnect
- Thread-safe for concurrent subscription requests on the same connection

## Testing

The implementation includes comprehensive boundary tests:

- ✅ Enforces default subscription limit
- ✅ Releases count on unsubscribe
- ✅ Releases count on disconnect
- ✅ Counts all subscription types
- ✅ Ignores duplicate subscriptions
- ✅ Allows exactly the limit
- ✅ Rejects bulk subscriptions that exceed limit
- ✅ Parses environment variable correctly
- ✅ Validates environment variable format

Run tests with:
```bash
pnpm --filter @oversync/relayer test websocket-server.test.ts
```
