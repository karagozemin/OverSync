import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Coordinator Config Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load config successfully with valid testnet env', () => {
    process.env.NETWORK_MODE = 'testnet';
    process.env.ETH_HTLC_ESCROW_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.ETH_RESOLVER_REGISTRY_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.SOROBAN_HTLC_TESTNET = 'C1234567890123456789012345678901234567890';
    process.env.SOROBAN_RESOLVER_REGISTRY_TESTNET = 'C1234567890123456789012345678901234567890';

    const config = loadConfig();
    expect(config.network).toBe('testnet');
    expect(config.ethereum.htlcEscrow).toBe('0x1234567890123456789012345678901234567890');
  });

  it('should throw error when testnet contract addresses are missing', () => {
    process.env.NETWORK_MODE = 'testnet';
    // Missing contract addresses

    expect(() => loadConfig()).toThrow('TESTNET DEPLOYMENT INCOMPLETE');
  });

  it('should throw error when mainnet is enabled without audit confirmation', () => {
    process.env.NETWORK_MODE = 'mainnet';
    // MAINNET_AUDIT_CONFIRMED is not set (defaults to false)

    expect(() => loadConfig()).toThrow('MAINNET DEPLOYMENT BLOCKED');
  });

  it('should throw error when mainnet audit confirmation is false', () => {
    process.env.NETWORK_MODE = 'mainnet';
    process.env.MAINNET_AUDIT_CONFIRMED = 'false';

    expect(() => loadConfig()).toThrow('MAINNET DEPLOYMENT BLOCKED');
  });

  it('should load config successfully with valid mainnet env and audit confirmation', () => {
    process.env.NETWORK_MODE = 'mainnet';
    process.env.MAINNET_AUDIT_CONFIRMED = 'true';
    process.env.ETH_HTLC_ESCROW_MAINNET = '0x1234567890123456789012345678901234567890';
    process.env.ETH_RESOLVER_REGISTRY_MAINNET = '0x1234567890123456789012345678901234567890';
    process.env.SOROBAN_HTLC_MAINNET = 'C1234567890123456789012345678901234567890';
    process.env.SOROBAN_RESOLVER_REGISTRY_MAINNET = 'C1234567890123456789012345678901234567890';

    const config = loadConfig();
    expect(config.network).toBe('mainnet');
    expect(config.mainnetAuditConfirmed).toBe(true);
  });

  it('should throw error for invalid network mode', () => {
    process.env.NETWORK_MODE = 'invalid';

    expect(() => loadConfig()).toThrow('NETWORK_MODE must be \'testnet\' or \'mainnet\'');
  });

  it('should validate Ethereum RPC URL format', () => {
    process.env.NETWORK_MODE = 'testnet';
    process.env.ETH_HTLC_ESCROW_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.ETH_RESOLVER_REGISTRY_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.SOROBAN_HTLC_TESTNET = 'C1234567890123456789012345678901234567890';
    process.env.SOROBAN_RESOLVER_REGISTRY_TESTNET = 'C1234567890123456789012345678901234567890';
    process.env.SEPOLIA_RPC_URL = 'not-a-valid-url';

    // Should throw due to invalid URL
    expect(() => loadConfig()).toThrow();
  });

  it('should accept valid Ethereum RPC URL', () => {
    process.env.NETWORK_MODE = 'testnet';
    process.env.ETH_HTLC_ESCROW_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.ETH_RESOLVER_REGISTRY_TESTNET = '0x1234567890123456789012345678901234567890';
    process.env.SOROBAN_HTLC_TESTNET = 'C1234567890123456789012345678901234567890';
    process.env.SOROBAN_RESOLVER_REGISTRY_TESTNET = 'C1234567890123456789012345678901234567890';
    process.env.SEPOLIA_RPC_URL = 'https://sepolia.infura.io/v3/abc123';

    const config = loadConfig();
    expect(config.ethereum.rpcUrl).toBe('https://sepolia.infura.io/v3/abc123');
  });
});