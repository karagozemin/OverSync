#!/usr/bin/env bash
# check-demo-env.sh — verify env vars are set and print the demo checklist
#
# This script reads .env from the repo root. It does NOT send transactions
# or modify any state. Use it before running a demo to confirm everything
# is configured correctly.
#
# Usage:
#   ./scripts/check-demo-env.sh
#   ./scripts/check-demo-env.sh /path/to/.env

set -euo pipefail

ENV_FILE="${1:-$(dirname "$0")/../.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ .env file not found at: $ENV_FILE"
  echo "   Run 'cp env.example .env' from the repo root and fill in values."
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

PASS=0
FAIL=0

check() {
  local var="$1"
  local label="${2:-$1}"
  if [[ -z "${!var:-}" ]]; then
    echo "  ⚠  $label (unset)"
    FAIL=$((FAIL + 1))
  else
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  fi
}

warn() {
  local var="$1"
  local label="${2:-$1}"
  if [[ -z "${!var:-}" ]]; then
    echo "  ○ $label (unset — OK for local demo)"
  else
    echo "  ✓ $label"
    PASS=$((PASS + 1))
  fi
}

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  OverSync Demo — Environment Check      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Network ──────────────────────────────────────────
echo "── Network ──────────────────────────────────"
check NETWORK_MODE "NETWORK_MODE (should be testnet)"
warn  INFURA_API_KEY "INFURA_API_KEY (optional, public fallback works)"
warn  SEPOLIA_RPC_URL "SEPOLIA_RPC_URL (optional)"
check SOROBAN_RPC_URL "SOROBAN_RPC_URL"

# ── Contract addresses ───────────────────────────────
echo ""
echo "── Contract addresses ───────────────────────"
if [[ -z "${ETH_HTLC_ESCROW_TESTNET:-}" && -z "${ETH_HTLC_FACTORY_TESTNET:-}" ]]; then
  echo "  ⚠  ETH_HTLC_ESCROW_TESTNET (unset)"
  FAIL=$((FAIL + 1))
else
  echo "  ✓ ETH_HTLC_ESCROW_TESTNET"
  PASS=$((PASS + 1))
fi
check ETH_RESOLVER_REGISTRY_TESTNET "ETH_RESOLVER_REGISTRY_TESTNET"
check SOROBAN_HTLC_TESTNET "SOROBAN_HTLC_TESTNET"
check SOROBAN_RESOLVER_REGISTRY_TESTNET "SOROBAN_RESOLVER_REGISTRY_TESTNET"

# ── Coordinator ──────────────────────────────────────
echo ""
echo "── Coordinator ──────────────────────────────"
warn  COORDINATOR_PORT "COORDINATOR_PORT (defaults to 3001)"
warn  DATABASE_URL "DATABASE_URL (defaults to file:./oversync.db)"

# ── Wallet checks (soft — no private keys required) ──
echo ""
echo "── Wallet readiness ─────────────────────────"
echo "  ○ MetaMask installed and connected to Sepolia"
echo "  ○ Freighter installed and connected to Stellar testnet"
echo "  ○ SepoliaETH faucet funded (≥ 0.1 ETH)"
echo "  ○ Stellar testnet XLM funded (≥ 500 XLM)"

# ── Summary ──────────────────────────────────────────
echo ""
echo "── Summary ──────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  echo "  ✅ $PASS/$((PASS + FAIL)) checks passed. Ready for demo."
else
  echo "  ⚠  $FAIL/$((PASS + FAIL)) checks need attention."
fi

echo ""
echo "── Demo checklist ───────────────────────────"
echo ""
echo "  [ ] 1. Start coordinator:   cd coordinator && pnpm dev"
echo "  [ ] 2. Start frontend:      cd frontend && pnpm dev"
echo "  [ ] 3. Open http://localhost:5173"
echo "  [ ] 4. Connect MetaMask (Sepolia) + Freighter (testnet)"
echo "  [ ] 5. Run ETH → XLM swap"
echo "  [ ] 6. Run XLM → ETH swap"
echo "  [ ] 7. Verify explorers (Sepolia Etherscan + StellarExpert)"
echo "  [ ] 8. (Optional) Start resolver: cd resolver && node dist/index.js run"
echo ""
