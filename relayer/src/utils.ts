/**
 * @fileoverview Utility functions for FusionBridge API
 * @description Helper functions for quote generation, validation, and order processing
 */

import { createHash, randomBytes } from 'crypto';
import { getAddress as ethersGetAddress } from 'ethers';
import { QuoteRequest, OrderInput, TimeLocks } from './types.js';

const STELLAR_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const ETH_HEX_RE = /^[0-9a-fA-F]+$/;

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
  return trimmed;
}

/**
 * Canonicalize an Ethereum address: trims surrounding whitespace,
 * requires 0x + exactly 40 hex digits, enforces the EIP-55 checksum for
 * mixed-case input, and returns the lowercase canonical form.
 * Throws on any malformed input.
 */
export function normalizeEthereumAddress(value: unknown, fieldName = 'Ethereum address'): string {
  const raw = assertNonEmptyString(value, fieldName);

  if (!raw.startsWith('0x')) {
    throw new Error(`${fieldName} must start with "0x"`);
  }
  const hex = raw.slice(2);
  if (hex.length !== 40) {
    throw new Error(`${fieldName} must be 40 hex digits after 0x (got ${hex.length})`);
  }
  if (!ETH_HEX_RE.test(hex)) {
    throw new Error(`${fieldName} contains invalid hex characters`);
  }
  try {
    // EIP-55: all-lowercase / all-uppercase are accepted, mixed-case must
    // carry a valid checksum.
    ethersGetAddress(raw);
  } catch {
    throw new Error(`${fieldName} has an invalid EIP-55 checksum`);
  }
  return raw.toLowerCase();
}

/**
 * Canonicalize a Stellar account address (G + 55 base32 chars). Stellar
 * IDs are case-sensitive, so the canonical form is the trimmed value
 * itself; anything else is rejected.
 */
export function normalizeStellarAddress(value: unknown, fieldName = 'Stellar address'): string {
  const raw = assertNonEmptyString(value, fieldName);
  if (!STELLAR_ACCOUNT_RE.test(raw)) {
    throw new Error(`${fieldName} must be a Stellar account ID (G + 55 base32 characters)`);
  }
  return raw;
}

/**
 * Canonicalize an address whose chain is inferred from its shape:
 * `0x…` → Ethereum, `G…` → Stellar, anything else rejected.
 */
export function normalizeAddress(value: unknown, fieldName = 'address'): string {
  const raw = assertNonEmptyString(value, fieldName);
  if (raw.startsWith('0x')) {
    return normalizeEthereumAddress(raw, fieldName);
  }
  return normalizeStellarAddress(raw, fieldName);
}

/**
 * Generate a unique quote ID
 */
export function generateQuoteId(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `quote_${timestamp}_${random}`;
}

/**
 * Generate a unique order hash
 */
export function generateOrderHash(order: OrderInput, srcChainId: number): string {
  const data = JSON.stringify({
    ...order,
    srcChainId
  });
  return '0x' + createHash('sha256').update(data).digest('hex');
}

/**
 * Generate random salt for orders
 */
export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Validate quote request parameters
 */
export function validateQuoteRequest(params: QuoteRequest): { valid: boolean; error?: string } {
  // Required fields
  const requiredFields: (keyof QuoteRequest)[] = [
    'srcChain', 'dstChain', 'srcTokenAddress', 
    'dstTokenAddress', 'amount', 'walletAddress'
  ];

  for (const field of requiredFields) {
    if (!params[field]) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Validate chain IDs
  if (params.srcChain === params.dstChain) {
    return { valid: false, error: 'Source and destination chains must be different' };
  }

  // Validate amount
  try {
    const amount = BigInt(params.amount);
    if (amount <= 0) {
      return { valid: false, error: 'Amount must be greater than 0' };
    }
  } catch {
    return { valid: false, error: 'Invalid amount format' };
  }

  // Validate addresses
  if (!isValidTokenAddress(params.srcTokenAddress) || 
      !isValidTokenAddress(params.dstTokenAddress) || 
      !isValidWalletAddress(params.walletAddress)) {
    return { valid: false, error: 'Invalid address format' };
  }

  return { valid: true };
}

/**
 * Validate token address format (can be symbol or address).
 * Surrounding whitespace is tolerated (canonicalized away) but every
 * other deviation from a well-formed address is rejected.
 */
export function isValidTokenAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length === 0) return false;

  // Common token symbols
  const tokenSymbols = ['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'BTC', 'XLM', 'MATIC', 'BNB'];
  if (tokenSymbols.includes(trimmed.toUpperCase())) {
    return true;
  }

  // Ethereum contract address (0x + exactly 40 hex digits, EIP-55 checked)
  if (trimmed.startsWith('0x')) {
    try {
      normalizeEthereumAddress(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  // Stellar asset code (max 12 chars)
  if (trimmed.length <= 12 && /^[A-Za-z0-9]+$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Validate wallet address format (Ethereum or Stellar).
 * Surrounding whitespace is tolerated (canonicalized away) but every
 * other deviation from a well-formed address is rejected.
 */
export function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length === 0) return false;

  // Ethereum address validation (0x + 40 hex chars, EIP-55 checked)
  if (trimmed.startsWith('0x')) {
    try {
      normalizeEthereumAddress(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  // Stellar address validation (G + 55 base32 chars, case-sensitive)
  if (trimmed.startsWith('G') && trimmed.length === 56) {
    return STELLAR_ACCOUNT_RE.test(trimmed);
  }

  // More flexible Stellar address validation (ledger / non-G prefixes)
  if (trimmed.length === 56 && /^[A-Z2-7]+$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Validate Ethereum/Stellar address format (legacy)
 */
export function isValidAddress(address: string): boolean {
  return isValidWalletAddress(address);
}

/**
 * Calculate fee amount
 */
export function calculateFee(amount: string, feeRate: number): string {
  const amountBigInt = BigInt(amount);
  const fee = (amountBigInt * BigInt(feeRate)) / BigInt(10000); // fee rate in basis points
  return fee.toString();
}

/**
 * Calculate destination amount after fee
 */
export function calculateDestinationAmount(amount: string, feeRate: number): string {
  const amountBigInt = BigInt(amount);
  const fee = calculateFee(amount, feeRate);
  const feeBigInt = BigInt(fee);
  return (amountBigInt - feeBigInt).toString();
}

/**
 * Generate default time locks
 */
export function generateDefaultTimeLocks(): TimeLocks {
  return {
    srcWithdrawal: 20,
    srcPublicWithdrawal: 120,
    srcCancellation: 121,
    srcPublicCancellation: 122,
    dstWithdrawal: 24,
    dstPublicWithdrawal: 100,
    dstCancellation: 101
  };
}

/**
 * Format amount for display (with decimals)
 */
export function formatAmount(amount: string, decimals: number = 18): string {
  const amountBigInt = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const integer = amountBigInt / divisor;
  const remainder = amountBigInt % divisor;
  
  if (remainder === 0n) {
    return integer.toString();
  }
  
  const decimal = remainder.toString().padStart(decimals, '0');
  return `${integer}.${decimal.replace(/0+$/, '')}`;
}

/**
 * Parse amount from display format
 */
export function parseAmount(amount: string, decimals: number = 18): string {
  const [integer, decimal = ''] = amount.split('.');
  const paddedDecimal = decimal.padEnd(decimals, '0');
  const totalString = integer + paddedDecimal;
  return BigInt(totalString).toString();
}

/**
 * Validate pagination parameters
 */
export function validatePagination(page?: number, limit?: number): { page: number; limit: number; error?: string } {
  const validatedPage = Math.max(1, page || 1);
  const validatedLimit = Math.min(500, Math.max(1, limit || 100));
  
  if (limit && limit > 500) {
    return {
      page: validatedPage,
      limit: validatedLimit,
      error: 'Limit cannot exceed 500'
    };
  }
  
  return {
    page: validatedPage,
    limit: validatedLimit
  };
}

/**
 * Create error response
 */
export function createErrorResponse(error: string, message?: string, code?: number) {
  return {
    error,
    message,
    code
  };
}

/**
 * Get error message from unknown error
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/**
 * Create success response
 */
export function createSuccessResponse(data: any, message?: string) {
  return {
    success: true,
    message,
    ...data
  };
}

/**
 * Generate current timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Add time to current timestamp
 */
export function addTimeToTimestamp(seconds: number): number {
  return getCurrentTimestamp() + seconds;
} 