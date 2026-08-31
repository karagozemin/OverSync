# Environment Validation Implementation

This document describes the strict environment validation system implemented across OverSync services to prevent misconfigured deployments.

## Overview

All OverSync services now perform **strict environment validation** at startup/build time:

- **Coordinator**: Zod schema validation + testnet contract address checks + mainnet audit gate
- **Resolver**: Zod schema validation + testnet contract address checks + mainnet audit gate  
- **Relayer**: Comprehensive validation of RPC URLs, contract addresses, private keys, and timeouts
- **Frontend**: Build-time validation (Vite) of contract addresses and network configuration

## Implementation Details

### Coordinator (`coordinator/src/config.ts`)

**Validation Logic:**
1. Loads env vars with dotenv
2. Validates `NETWORK_MODE` (must be 'testnet' or 'mainnet')
3. **Mainnet Gate**: Checks `MAINNET_AUDIT_CONFIRMED=true` if `NETWORK_MODE=mainnet`
4. Parses config through Zod schema with strict type checking
5. **Testnet Contract Check**: Ensures all testnet contract addresses are present
6. Throws descriptive errors if validation fails

**Key Validations:**
- Network mode enum validation
- Mainnet audit confirmation (prevents accidental mainnet deployment)
- Testnet contract addresses required: `ETH_HTLC_ESCROW_TESTNET`, `ETH_RESOLVER_REGISTRY_TESTNET`, `SOROBAN_HTLC_TESTNET`, `SOROBAN_RESOLVER_REGISTRY_TESTNET`
- Ethereum RPC URL format validation
- Soroban RPC URL format validation
- Port, timeouts, and numeric parameter validation

### Resolver (`resolver/src/config.ts`)

**Validation Logic:**
1. Loads env vars with dotenv
2. Validates `NETWORK_MODE` (must be 'testnet' or 'mainnet')
3. **Mainnet Gate**: Checks `MAINNET_AUDIT_CONFIRMED=true` if `NETWORK_MODE=mainnet`
4. Parses config through Zod schema
5. **Testnet Contract Check**: Ensures all testnet contract addresses are present
6. Converts validated config to legacy format for backward compatibility
7. Throws descriptive errors if validation fails

**Key Validations:**
- Same as coordinator
- Additional validation for resolver private key format (`0x`-prefixed 64-byte hex)
- Stellar secret validation

### Relayer (`relayer/src/index.ts`)

**Validation Logic:**
1. Validates `NETWORK_MODE` (must be 'testnet' or 'mainnet')
2. **Mainnet Gate**: Checks `MAINNET_AUDIT_CONFIRMED=true` if `NETWORK_MODE=mainnet`
3. Validates Ethereum RPC URL (not placeholder)
4. Validates Stellar Horizon URL (not placeholder)
5. **Private Key Validation**: Checks relayer Ethereum and Stellar keys are configured
6. **Testnet Contract Check**: Ensures testnet contract addresses present
7. Validates timeout ranges (1000-300000ms)
8. Calls `process.exit(1)` on validation failure (fails fast)

**Key Validations:**
- RPC URL configuration
- Private key presence and format
- Contract address presence for testnet
- Timeout value ranges
- Emergency shutdown flag

### Frontend (`frontend/src/config/networks.ts`)

**Validation Logic:**
1. Runs at module load time (Vite build time)
2. Detects network mode from `VITE_NETWORK_MODE` or `VITE_NETWORK`
3. **Mainnet Gate**: Checks both `VITE_MAINNET_ENABLED=true` AND `VITE_MAINNET_AUDIT_CONFIRMED=true`
4. **Testnet Contract Check**: Validates `VITE_ETH_HTLC_ESCROW_TESTNET` and `VITE_ETH_RESOLVER_REGISTRY_TESTNET`
5. **Mainnet Contract Check**: Validates mainnet addresses if mainnet enabled
6. Validates API base URL
7. Validates RPC URLs
8. Throws error to fail Vite build if validation fails

**Key Validations:**
- Mainnet enablement requires TWO flags (prevents accidental enablement)
- Contract addresses for active network mode
- API base URL configuration
- RPC URL configuration

## Mainnet Safety Mechanism

Mainnet deployment requires **explicit confirmation** through a multi-step process:

### Backend Services
```bash
# Step 1: Set network mode
NETWORK_MODE=mainnet

# Step 2: Explicitly confirm audit completion
MAINNET_AUDIT_CONFIRMED=true
```

### Frontend (Vercel)
```bash
# Step 1: Enable mainnet toggle
VITE_MAINNET_ENABLED=true

# Step 2: Confirm audit completion
VITE_MAINNET_AUDIT_CONFIRMED=true
```

**This two-step process prevents accidental mainnet enablement.** A single misconfigured flag will block deployment with a clear error message.

## Error Messages

All validation errors are **descriptive and actionable**:

### Mainnet Blocked
```
MAINNET DEPLOYMENT BLOCKED: Set MAINNET_AUDIT_CONFIRMED=true only after 
completing the mainnet readiness checklist in docs/DEPLOYMENT.md. 
This includes audit completion, multisig ownership, and bug bounty.
```

### Testnet Incomplete
```
TESTNET DEPLOYMENT INCOMPLETE: Missing required testnet contract addresses: 
ETH_HTLC_ESCROW_TESTNET, SOROBAN_HTLC_TESTNET. 
Deploy contracts first (see docs/DEPLOYMENT.md) or check env.example for variable names.
```

### Frontend Build Failure
```
❌ FRONTEND ENVIRONMENT VALIDATION FAILED:
   - MAINNET DEPLOYMENT BLOCKED: Set VITE_MAINNET_AUDIT_CONFIRMED=true only after...
   - TESTNET CONFIG INCOMPLETE: Missing or placeholder testnet contract addresses:...

Frontend build blocked. Fix the above errors and rebuild.
```

## Environment Variables

See [`env.example`](../env.example) for the complete list of environment variables with descriptions.

### Critical Variables by Service

**Coordinator/Resolver:**
- `NETWORK_MODE` - 'testnet' or 'mainnet'
- `MAINNET_AUDIT_CONFIRMED` - Must be 'true' for mainnet
- `ETH_HTLC_ESCROW_TESTNET` / `ETH_HTLC_ESCROW_MAINNET`
- `ETH_RESOLVER_REGISTRY_TESTNET` / `ETH_RESOLVER_REGISTRY_MAINNET`
- `SOROBAN_HTLC_TESTNET` / `SOROBAN_HTLC_MAINNET`
- `SOROBAN_RESOLVER_REGISTRY_TESTNET` / `SOROBAN_RESOLVER_REGISTRY_MAINNET`

**Relayer:**
- `RELAYER_PRIVATE_KEY` - Ethereum private key
- `RELAYER_STELLAR_SECRET` - Stellar secret key
- `RELAYER_STELLAR_PUBLIC` - Stellar public key
- `RELAYER_RPC_TIMEOUT_MS` - RPC timeout (1000-300000ms)

**Frontend:**
- `VITE_NETWORK_MODE` - 'testnet' or 'mainnet'
- `VITE_MAINNET_ENABLED` - Must be 'true' for mainnet
- `VITE_MAINNET_AUDIT_CONFIRMED` - Must be 'true' for mainnet
- `VITE_ETH_HTLC_ESCROW_TESTNET` / `VITE_ETH_HTLC_ESCROW_MAINNET`
- `VITE_API_BASE_URL` - Coordinator API URL

## Testing

Smoke tests cover invalid environment cases:

**Test File:** `coordinator/test/config-validation.test.ts`

**Test Cases:**
1. ✅ Valid testnet configuration loads successfully
2. ✅ Missing testnet contract addresses throws error
3. ✅ Mainnet without audit confirmation throws error
4. ✅ Mainnet with `MAINNET_AUDIT_CONFIRMED=false` throws error
5. ✅ Valid mainnet with audit confirmation loads successfully
6. ✅ Invalid network mode throws error
7. ✅ Invalid RPC URL format throws error
8. ✅ Valid RPC URL is accepted

## Deployment Checklist

### Testnet Deployment
1. Set `NETWORK_MODE=testnet`
2. Deploy Soroban contracts → set `SOROBAN_HTLC_TESTNET`, `SOROBAN_RESOLVER_REGISTRY_TESTNET`
3. Deploy Ethereum contracts → set `ETH_HTLC_ESCROW_TESTNET`, `ETH_RESOLVER_REGISTRY_TESTNET`
4. Start services → validation passes automatically

### Mainnet Deployment
1. Complete mainnet readiness checklist (see `docs/DEPLOYMENT.md`)
2. Set `NETWORK_MODE=mainnet`
3. Set `MAINNET_AUDIT_CONFIRMED=true` in backend `.env`
4. Deploy mainnet contracts → set mainnet contract addresses
5. Set `VITE_MAINNET_ENABLED=true` and `VITE_MAINNET_AUDIT_CONFIRMED=true` in Vercel
6. Deploy frontend → build passes validation
7. Deploy backend services → validation passes

## Troubleshooting

### "MAINNET DEPLOYMENT BLOCKED"
**Cause:** `NETWORK_MODE=mainnet` but `MAINNET_AUDIT_CONFIRMED` is not set to 'true'  
**Fix:** Complete the mainnet readiness checklist, then set `MAINNET_AUDIT_CONFIRMED=true`

### "TESTNET DEPLOYMENT INCOMPLETE"
**Cause:** Testnet contract addresses are missing  
**Fix:** Deploy testnet contracts and set the contract address environment variables

### "Frontend environment validation failed"
**Cause:** Frontend build is missing required Vite environment variables  
**Fix:** Check Vercel environment variables for missing `VITE_*` contract addresses

## Benefits

1. **Fail Fast**: Services refuse to start with invalid configuration
2. **Clear Errors**: Descriptive error messages guide operators to fix issues
3. **Prevents Accidental Mainnet**: Multi-step mainnet enablement prevents costly mistakes
4. **CI/CD Friendly**: Build failures surface configuration issues before deployment
5. **Documentation**: env.example and DEPLOYMENT.md document all required variables
6. **Type Safety**: Zod schemas provide runtime type validation with TypeScript inference

## Migration Guide

### For Existing Deployments

If you have an existing deployment:

1. **Add `MAINNET_AUDIT_CONFIRMED=false`** to your `.env` (if not present)
2. **Verify testnet contract addresses** are set (if using testnet)
3. **Restart services** - they will validate on startup
4. **Check logs** for any validation warnings

### For New Deployments

1. Copy `env.example` to `.env`
2. Follow the deployment guide in `docs/DEPLOYMENT.md`
3. Services will validate automatically on startup
4. Fix any validation errors before proceeding

## References

- `env.example` - Complete environment variable reference
- `docs/DEPLOYMENT.md` - Step-by-step deployment guide
- `coordinator/src/config.ts` - Coordinator validation implementation
- `resolver/src/config.ts` - Resolver validation implementation
- `relayer/src/index.ts` - Relayer validation implementation
- `frontend/src/config/networks.ts` - Frontend validation implementation
- `coordinator/test/config-validation.test.ts` - Smoke tests for invalid env cases