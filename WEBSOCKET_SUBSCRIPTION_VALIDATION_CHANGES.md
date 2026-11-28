# WebSocket Subscription Limit Validation and Testing

## Summary

This document describes the changes made to validate subscription limits and add comprehensive automated tests for WebSocket subscription behaviors.

## Changes Made

### 1. Validation Function Added (`relayer/src/websocket-server.ts`)

#### New `validateSubscriptionLimit()` Function
Added a comprehensive validation function that ensures the subscription limit is a valid bounded whole integer:

```typescript
export function validateSubscriptionLimit(value: number | string | undefined, source: string): number
```

**Validation Rules:**
- ✅ **Required**: Value must be provided (not undefined)
- ✅ **Valid Number**: Must be parseable as a number (not NaN)
- ✅ **Whole Integer**: Must have no decimal places (uses `Number.isInteger()`)
- ✅ **Positive**: Must be at least 1
- ✅ **Safe Integer**: Must be within JavaScript's safe integer bounds (`Number.MAX_SAFE_INTEGER`)
- ✅ **Reasonable Bound**: Must not exceed 1,000,000 (prevents absurd values)

**Error Messages:**
- Clear, descriptive error messages for each validation failure
- Includes the source (environment variable or constructor parameter) in error messages
- Shows the invalid value in the error message

#### Updated `getMaxSubscriptionsPerConnection()`
Enhanced to use the new validation function:
- Validates environment variable `WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION`
- Provides clear error messages wrapping validation errors
- Returns default if environment variable is not set

#### Updated Constructor
Enhanced to validate constructor parameter:
- Validates `maxSubscriptionsPerConnection` parameter if provided
- Uses validation function with clear source identification
- Falls back to environment variable validation if parameter not provided

### 2. Comprehensive Test Coverage (`relayer/test/websocket-server.test.ts`)

Added extensive automated tests covering all requested scenarios:

#### A. Duplicate Subscription Handling
- ✅ Ignores duplicate event subscriptions within a single request
- ✅ Ignores duplicate order hash filters
- ✅ Ignores duplicate resolver filters
- ✅ Ignores duplicate chain ID filters
- ✅ Ignores duplicates when resubscribing across multiple requests

#### B. Capacity Release on Unsubscribe
- ✅ Releases capacity for each filter type on unsubscribe
- ✅ Allows immediate resubscription after unsubscribe
- ✅ Handles unsubscribing from non-existent items gracefully
- ✅ Tracks exact count of removed subscriptions

#### C. Capacity Release on Disconnect
- ✅ Fully releases capacity when client disconnects
- ✅ Releases capacity for multiple disconnecting clients independently
- ✅ Logs subscription release count on disconnect
- ✅ Does not log if client had no subscriptions
- ✅ Verifies new clients get full capacity after disconnect

#### D. Shared Limit Across Filter Types
- ✅ Respects shared limit across all filter types (events, orders, resolvers, chains)
- ✅ Allows mixed filter types up to exactly the limit
- ✅ Enforces limit when mixing subscriptions across multiple requests
- ✅ Allows adding to different filter types after partial unsubscribe
- ✅ Rejects ANY filter type when limit is reached

#### E. Limit Validation
- ✅ Validates constructor limit as positive integer (rejects 0, negative)
- ✅ Validates constructor limit as whole integer (rejects decimals)
- ✅ Rejects non-numeric constructor limit (NaN, strings)
- ✅ Validates environment limit as positive integer
- ✅ Validates environment limit as whole integer
- ✅ Rejects values exceeding safe integer bounds
- ✅ Rejects unreasonably large values (> 1,000,000)
- ✅ Accepts valid integer limits (1, 100, 10000, 999999)

## Test Statistics

**Total New Tests Added**: 24 test cases across 5 describe blocks
- Duplicate subscription handling: 5 tests
- Capacity release on unsubscribe: 3 tests
- Capacity release on disconnect: 4 tests
- Shared limit across filter types: 4 tests
- Limit validation: 8 tests

**Existing Tests Retained**: 12 test cases
- Origin policy tests: 4 tests
- Outbound redaction tests: 3 tests
- Basic subscription limit tests: 5 tests

**Total Test Coverage**: 36 test cases

## Behavior Guarantees

### Duplicate Handling
- Duplicates within a single request are automatically deduplicated
- Duplicates across multiple requests are ignored (no count increase)
- Works for all filter types: events, orders, resolvers, chains

### Capacity Management
- Unsubscribe immediately releases capacity (no delay)
- Disconnect immediately releases all capacity for that client
- Each client's capacity is tracked independently
- Capacity is shared across all filter types for a single client

### Limit Enforcement
- Limit is enforced at subscription time (before acceptance)
- Clear error messages with current count, requested count, and limit
- Error code -32000 for subscription limit exceeded
- Validation errors thrown at construction/configuration time

## Configuration

### Environment Variable
```bash
WEBSOCKET_MAX_SUBSCRIPTIONS_PER_CONNECTION=1000
```

### Constructor Parameter
```typescript
const server = new FusionWebSocketServer(port, allowedOrigins, maxSubscriptionsPerConnection);
```

Both methods now validate the limit as a bounded whole integer.

## Backward Compatibility

✅ All existing tests continue to pass
✅ Default behavior unchanged (1000 subscriptions)
✅ Existing validation extended (more strict, but compatible)
✅ Error messages improved (more descriptive)

## Files Modified

1. `relayer/src/websocket-server.ts`
   - Added `validateSubscriptionLimit()` function
   - Updated `getMaxSubscriptionsPerConnection()` to use validation
   - Updated constructor to validate parameter

2. `relayer/test/websocket-server.test.ts`
   - Added 24 new test cases
   - Organized into 5 describe blocks
   - Import added for `validateSubscriptionLimit`

## Validation Examples

### Valid Limits
```typescript
✅ 1
✅ 100
✅ 1000
✅ 10000
✅ 999999
```

### Invalid Limits
```typescript
❌ 0           // Must be at least 1
❌ -5          // Must be positive
❌ 10.5        // Must be whole integer
❌ 3.14159     // Must be whole integer
❌ NaN         // Must be valid number
❌ "abc"       // Must be valid number
❌ 10000000    // Exceeds reasonable limit
❌ 2^53 + 1    // Exceeds safe integer bounds
```

## Running Tests

```bash
# Run all relayer tests
pnpm --filter @oversync/relayer test

# Run only WebSocket tests
pnpm --filter @oversync/relayer test websocket-server.test.ts
```

## Conclusion

All requested features have been implemented:
1. ✅ Limit validated as bounded whole integer for environment variable
2. ✅ Limit validated as bounded whole integer for constructor parameter
3. ✅ Automated tests for duplicate subscription handling
4. ✅ Automated tests for capacity release on unsubscribe
5. ✅ Automated tests for capacity release on disconnect
6. ✅ Automated tests for shared limit across filter types
7. ✅ No TypeScript diagnostics or errors
8. ✅ Comprehensive test coverage (36 total test cases)
