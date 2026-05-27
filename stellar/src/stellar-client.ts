/**
 * @fileoverview Main Stellar Client for FusionBridge
 * @description Integrates HTLC claimable balance functionality with relayer interface
 */

import {
  StellarHTLCManager,
  StellarConfig,
  HTLCClaimableBalanceParams,
  ClaimParams,
  RefundParams,
  ClaimableBalanceInfo,
  createTestnetConfig,
  createMainnetConfig,
  generatePreimageAndHash,
  verifyPreimage,
} from './claimable-balance.js';
import { resolveStellarAsset } from '@oversync/sdk';

/**
 * Cross-chain order data from Ethereum
 */
export interface CrossChainOrder {
  ethereumOrderId: number;
  ethereumTxHash: string;
  token: string;
  amount: string;
  hashLock: string;
  timelock: number;
  sender: string;
  recipient: string;
}

/**
 * Stellar bridge transaction result
 */
export interface StellarBridgeResult {
  success: boolean;
  txHash?: string;
  balanceId?: string;
  error?: string;
}

/**
 * Main Stellar client for FusionBridge cross-chain operations
 */
export default class StellarClient {
  private htlcManager: StellarHTLCManager;
  private config: StellarConfig;
  private relayerSecretKey: string;

  private readonly isTestnet: boolean;

  constructor(isTestnet: boolean = true, relayerSecretKey?: string) {
    this.isTestnet = isTestnet;
    this.config = isTestnet ? createTestnetConfig() : createMainnetConfig();
    this.htlcManager = new StellarHTLCManager(this.config);

    // Use provided secret key or get from environment
    this.relayerSecretKey = relayerSecretKey ||
      process.env.RELAYER_STELLAR_SECRET ||
      'SAMPLERELAYERSECRETKEYFORTEST12345678901234567890';
  }

  /**
   * Create HTLC claimable balance in response to Ethereum order
   * @param order Cross-chain order from Ethereum
   * @returns Bridge transaction result
   */
  async createHTLCFromEthereumOrder(
    order: CrossChainOrder
  ): Promise<StellarBridgeResult> {
    try {
      console.log(`🌉 Creating Stellar HTLC for Ethereum order ${order.ethereumOrderId}`);

      const stellarAsset = resolveStellarAsset(order.token, this.isTestnet ? 'testnet' : 'mainnet');
      const params: HTLCClaimableBalanceParams = {
        sourceSecretKey: this.relayerSecretKey,
        recipientPublicKey: order.recipient,
        assetCode: stellarAsset.code,
        assetIssuer: stellarAsset.issuer,
        amount: order.amount,
        hashLock: order.hashLock,
        timelock: order.timelock,
        memo: `ETH-${order.ethereumOrderId}`,
      };

      const result = await this.htlcManager.createClaimableBalance(params);

      console.log(`✅ Stellar HTLC created for Ethereum order ${order.ethereumOrderId}`);
      console.log(`🆔 Claimable Balance ID: ${result.balanceId}`);

      return {
        success: true,
        txHash: result.txHash,
        balanceId: result.balanceId,
      };
    } catch (error) {
      console.error(`❌ Failed to create Stellar HTLC:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Claim Stellar claimable balance with preimage
   * @param balanceId Claimable balance ID
   * @param preimage Secret preimage
   * @returns Bridge transaction result
   */
  async claimStellarHTLC(
    balanceId: string,
    preimage: string
  ): Promise<StellarBridgeResult> {
    try {
      console.log(`🔑 Claiming Stellar HTLC: ${balanceId}`);

      const claimParams: ClaimParams = {
        claimerSecretKey: this.relayerSecretKey,
        balanceId,
        preimage,
      };

      const txHash = await this.htlcManager.claimWithPreimage(claimParams);

      console.log(`✅ Stellar HTLC claimed successfully`);

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      console.error(`❌ Failed to claim Stellar HTLC:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refund expired Stellar claimable balance
   * @param balanceId Claimable balance ID
   * @returns Bridge transaction result
   */
  async refundStellarHTLC(
    balanceId: string
  ): Promise<StellarBridgeResult> {
    try {
      console.log(`🔄 Refunding expired Stellar HTLC: ${balanceId}`);

      const refundParams: RefundParams = {
        refunderSecretKey: this.relayerSecretKey,
        balanceId,
      };

      const txHash = await this.htlcManager.refundExpired(refundParams);

      console.log(`✅ Stellar HTLC refunded successfully`);

      return {
        success: true,
        txHash,
      };
    } catch (error) {
      console.error(`❌ Failed to refund Stellar HTLC:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get claimable balance information
   * @param balanceId Claimable balance ID
   * @returns Balance information or null if not found
   */
  async getClaimableBalanceInfo(balanceId: string): Promise<ClaimableBalanceInfo | null> {
    try {
      return await this.htlcManager.getClaimableBalanceInfo(balanceId);
    } catch (error) {
      console.error(`❌ Failed to get balance info:`, error);
      return null;
    }
  }

  /**
   * List all claimable balances for an account
   * @param accountId Stellar account public key
   * @returns Array of claimable balances
   */
  async getAccountClaimableBalances(accountId: string): Promise<ClaimableBalanceInfo[]> {
    try {
      return await this.htlcManager.getClaimableBalances(accountId);
    } catch (error) {
      console.error(`❌ Failed to get account balances:`, error);
      return [];
    }
  }

  /**
   * Generate preimage and hash for new HTLC
   * @returns Preimage and corresponding hash
   */
  generateSecret(): { preimage: string; hash: string } {
    return generatePreimageAndHash();
  }

  /**
   * Verify that preimage matches expected hash
   * @param preimage Secret preimage
   * @param expectedHash Expected hash value
   * @returns Whether preimage is valid
   */
  verifySecret(preimage: string, expectedHash: string): boolean {
    return verifyPreimage(preimage, expectedHash);
  }

  /**
   * Get network configuration
   * @returns Current Stellar network config
   */
  getNetworkConfig(): StellarConfig {
    return this.config;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS  
  // ═══════════════════════════════════════════════════════════════════════════════════════

}

// Export utilities for external use
export {
  StellarHTLCManager,
  createTestnetConfig,
  createMainnetConfig,
  generatePreimageAndHash,
  verifyPreimage,
}; 