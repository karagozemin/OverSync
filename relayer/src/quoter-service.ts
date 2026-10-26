/**
 * @fileoverview Enhanced Quoter Service for FusionBridge API
 * @description Provides accurate quotes with Dutch auction pricing and gas optimization
 */


import { gasPriceTracker } from './gas-tracker.js';
import { getCurrentTimestamp } from './utils.js';
import {
  RelayRefusalError,
  type RelayAction,
  type RelaySubmissionTracker,
} from './relay-submission-tracker.js';

/**
 * Quote request parameters
 */
export interface QuoteRequest {
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  amount: string;
  slippage: number;
  userAddress: string;
  preset?: 'fast' | 'medium' | 'slow';

}

/**
 * Quote response
 */
export interface QuoteResponse {
  quoteId: string;
  fromToken: string;
  toToken: string;
  fromChain: string;
  toChain: string;
  fromAmount: string;
  toAmount: string;
  minimumReceived: string;
  priceImpact: string;
  estimatedGas: string;
  gasPrice: string;
  executionTime: number;

  auctionPricing: {
    startPrice: string;
    currentPrice: string;
    endPrice: string;
    progress: number;
    timeRemaining: number;
  };
  fee: {
    amount: string;
    token: string;
    percentage: string;
  };
  route: {
    fromToken: string;
    toToken: string;
    exchange: string;
    portion: number;
  }[];
  timestamp: number;
  validUntil: number;
}

interface CoordinatorQuote {
  fresh: boolean;
  fromAsset: string;
  toAsset: string;
  amount: string;
  fromNetwork: string;
  toNetwork: string;
  expiresAt: number;
}

/**
 * Token price information
 */
interface TokenPrice {
  token: string;
  price: string;
  decimals: number;
  symbol: string;
}

/**
 * Enhanced Quoter Service Class
 */
export class QuoterService {
  private tokenPrices: Map<string, TokenPrice> = new Map();
  private quotes: Map<string, QuoteResponse> = new Map();
  private readonly QUOTE_VALIDITY_DURATION = 300; // 5 minutes

  constructor() {
    this.initializeTokenPrices();
  }

  /** Re-read the accepted coordinator quote inside the tracked attempt. */
  async submitIfCoordinatorQuoteMatches<R>(
    quote: QuoteResponse | undefined,
    coordinatorQuoteId: string | undefined,
    action: RelayAction,
    tracker: RelaySubmissionTracker,
    executor: () => Promise<R>
  ) {
    return tracker.submit(action, async () => {
      if (!quote || !coordinatorQuoteId) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_REQUIRED');
      }
      const baseUrl = (process.env.COORDINATOR_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
      let response: Response;
      try {
        response = await fetch(
          `${baseUrl}/api/quotes/${encodeURIComponent(coordinatorQuoteId)}/status`
        );
      } catch {
        throw new RelayRefusalError('COORDINATOR_QUOTE_UNAVAILABLE');
      }
      if (response.status === 410) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_EXPIRED');
      }
      if (!response.ok) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_UNAVAILABLE');
      }

      let coordinatorQuote: CoordinatorQuote;
      try {
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') throw new Error('invalid quote response');
        coordinatorQuote = body as CoordinatorQuote;
      } catch {
        throw new RelayRefusalError('COORDINATOR_QUOTE_INVALID');
      }

      if (
        typeof coordinatorQuote.fresh !== 'boolean' ||
        typeof coordinatorQuote.fromAsset !== 'string' ||
        typeof coordinatorQuote.toAsset !== 'string' ||
        typeof coordinatorQuote.amount !== 'string' ||
        typeof coordinatorQuote.fromNetwork !== 'string' ||
        typeof coordinatorQuote.toNetwork !== 'string' ||
        typeof coordinatorQuote.expiresAt !== 'number'
      ) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_INVALID');
      }

      const expiryMs = coordinatorQuote.expiresAt < 1_000_000_000_000
        ? coordinatorQuote.expiresAt * 1000
        : coordinatorQuote.expiresAt;
      if (!coordinatorQuote.fresh || !Number.isFinite(expiryMs) || Date.now() > expiryMs) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_EXPIRED');
      }

      const localExpiryMs = quote.validUntil < 1_000_000_000_000
        ? quote.validUntil * 1000
        : quote.validUntil;
      const matches =
        coordinatorQuote.fromAsset?.toLowerCase() === quote.fromToken.toLowerCase() &&
        coordinatorQuote.toAsset?.toLowerCase() === quote.toToken.toLowerCase() &&
        coordinatorQuote.amount === quote.fromAmount &&
        coordinatorQuote.fromNetwork?.toLowerCase() === quote.fromChain.toLowerCase() &&
        coordinatorQuote.toNetwork?.toLowerCase() === quote.toChain.toLowerCase() &&
        expiryMs === localExpiryMs;
      if (!matches) {
        throw new RelayRefusalError('COORDINATOR_QUOTE_MISMATCH');
      }

      return executor();
    });
  }

  /**
   * Get a quote for token swap
   */
  async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    console.log('💱 Generating quote for:', request);

    // Validate request
    this.validateQuoteRequest(request);

    // Get token prices
    const fromTokenPrice = await this.getTokenPrice(request.fromToken);
    const toTokenPrice = await this.getTokenPrice(request.toToken);

    // Calculate base exchange rate
    const baseRate = this.calculateBaseRate(fromTokenPrice, toTokenPrice);

    // Calculate amount after slippage
    const { toAmount, minimumReceived } = this.calculateAmountWithSlippage(
      request.amount,
      baseRate,
      request.slippage,
      fromTokenPrice.decimals,
      toTokenPrice.decimals
    );

    // Get gas price recommendation
    const gasPrice = gasPriceTracker.getOptimalGasPrice('standard');
    const estimatedGas = this.estimateGasUsage(request.fromChain, request.toChain);

    // Create auction configuration
    const auctionConfig = this.createAuctionConfig(request, gasPrice);

    // Calculate pricing (simplified without auction)
    const currentPrice = toAmount;
    const finalPrice = toAmount;
    const auctionProgress = 0;
    const timeRemaining = 0;

    // Calculate fees
    const fee = this.calculateFee(request.amount, request.fromChain, request.toChain);

    // Generate quote ID
    const quoteId = this.generateQuoteId();

    // Create quote response
    const quote: QuoteResponse = {
      quoteId,
      fromToken: request.fromToken,
      toToken: request.toToken,
      fromChain: request.fromChain,
      toChain: request.toChain,
      fromAmount: request.amount,
      toAmount: toAmount,
      minimumReceived: minimumReceived,
      priceImpact: this.calculatePriceImpact(request.amount, toAmount, baseRate, fromTokenPrice.decimals, toTokenPrice.decimals),
      estimatedGas: estimatedGas,
      gasPrice: gasPrice,
          executionTime: 300, // Fixed execution time
          auctionPricing: {
      startPrice: currentPrice,
      currentPrice: currentPrice,
      endPrice: finalPrice,
      progress: auctionProgress,
      timeRemaining: timeRemaining
    },
      fee,
      route: await this.getOptimalRoute(request),
      timestamp: getCurrentTimestamp(),
      validUntil: getCurrentTimestamp() + this.QUOTE_VALIDITY_DURATION
    };

    // Store quote
    this.quotes.set(quoteId, quote);

    console.log('✅ Quote generated:', quoteId);
    return quote;
  }

  /**
   * Update quote pricing based on current auction state
   */
  async updateQuotePricing(quoteId: string): Promise<QuoteResponse | null> {
    const quote = this.quotes.get(quoteId);
    if (!quote) {
      return null;
    }

    // Check if quote is still valid
    if (getCurrentTimestamp() > quote.validUntil) {
      this.quotes.delete(quoteId);
      return null;
    }

    // Update pricing (simplified without auction)
    const currentPrice = quote.toAmount;
    const finalPrice = quote.toAmount;
    const auctionProgress = 0;
    const timeRemaining = 0;

    // Update quote with new pricing
    quote.auctionPricing = {
      startPrice: quote.auctionPricing.startPrice,
      currentPrice: currentPrice,
      endPrice: finalPrice,
      progress: auctionProgress,
      timeRemaining: timeRemaining
    };

    return quote;
  }

  /**
   * Get quote by ID
   */
  getQuoteById(quoteId: string): QuoteResponse | null {
    return this.quotes.get(quoteId) || null;
  }

  /**
   * Get all active quotes
   */
  getActiveQuotes(): QuoteResponse[] {
    const now = getCurrentTimestamp();
    const activeQuotes: QuoteResponse[] = [];

    for (const [quoteId, quote] of this.quotes) {
      if (quote.validUntil > now) {
        activeQuotes.push(quote);
      } else {
        this.quotes.delete(quoteId);
      }
    }

    return activeQuotes;
  }

  /**
   * Get best quote for parameters
   */
  async getBestQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const quotes = await Promise.all([
      this.getQuote({ ...request, preset: 'fast' }),
      this.getQuote({ ...request, preset: 'medium' }),
      this.getQuote({ ...request, preset: 'slow' })
    ]);

    // Find best quote based on final price
    return quotes.reduce((best, current) => {
      const bestFinalPrice = BigInt(best.auctionPricing.endPrice);
      const currentFinalPrice = BigInt(current.auctionPricing.endPrice);
      return currentFinalPrice > bestFinalPrice ? current : best;
    });
  }

  /**
   * Validate quote request
   */
  private validateQuoteRequest(request: QuoteRequest): void {
    if (!request.fromToken || !request.toToken) {
      throw new Error('Both fromToken and toToken are required');
    }

    if (!request.fromChain || !request.toChain) {
      throw new Error('Both fromChain and toChain are required');
    }

    if (!request.amount || BigInt(request.amount) <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    if (request.slippage < 0 || request.slippage > 5) {
      throw new Error('Slippage must be between 0 and 5 percent');
    }

    if (!request.userAddress) {
      throw new Error('User address is required');
    }
  }

  /**
   * Get token price
   */
  private async getTokenPrice(token: string): Promise<TokenPrice> {
    let price = this.tokenPrices.get(token);
    
    if (!price) {
      // In production, fetch from price oracle
      price = await this.fetchTokenPriceFromOracle(token);
      this.tokenPrices.set(token, price);
    }

    return price;
  }

  /**
   * Calculate base exchange rate
   */
  private calculateBaseRate(fromToken: TokenPrice, toToken: TokenPrice): string {
    const fromPriceBigInt = BigInt(fromToken.price);
    const toPriceBigInt = BigInt(toToken.price);
    
    // Normalize prices to same decimal base (18 decimals)
    const fromPriceNormalized = fromPriceBigInt * BigInt(10 ** (18 - fromToken.decimals));
    const toPriceNormalized = toPriceBigInt * BigInt(10 ** (18 - toToken.decimals));
    
    // Calculate rate with proper decimal handling
    const rate = (fromPriceNormalized * BigInt(10 ** Math.max(fromToken.decimals, toToken.decimals))) / toPriceNormalized;
    return rate.toString();
  }

  /**
   * Calculate amount with slippage
   */
  private calculateAmountWithSlippage(
    amount: string,
    rate: string,
    slippage: number,
    fromDecimals: number = 18,
    toDecimals: number = 18
  ): { toAmount: string; minimumReceived: string } {
    const amountBigInt = BigInt(amount);
    const rateBigInt = BigInt(rate);
    
    // Use appropriate decimals for calculation
    const decimalAdjustment = Math.max(fromDecimals, toDecimals);
    const baseToAmount = (amountBigInt * rateBigInt) / BigInt(10 ** decimalAdjustment);
    const slippageBps = Math.floor(slippage * 100);
    const minimumReceived = (baseToAmount * BigInt(10000 - slippageBps)) / BigInt(10000);
    
    return {
      toAmount: baseToAmount.toString(),
      minimumReceived: minimumReceived.toString()
    };
  }

  /**
   * Create auction configuration
   */
  private createAuctionConfig(request: QuoteRequest, gasPrice: string): any {
    // Simplified config without auction
    return {
      startTime: getCurrentTimestamp() + 5,
      auctionDuration: 300,
      initialRateBump: 0,
      points: [],
      gasCost: {
        gasBumpEstimate: 0,
        gasPriceEstimate: gasPrice
      }
    };
  }

  /**
   * Calculate fee
   */
  private calculateFee(amount: string, fromChain: string, toChain: string): {
    amount: string;
    token: string;
    percentage: string;
  } {
    // Base fee: 0.1% for same chain, 0.3% for cross-chain
    const baseFeePercentage = fromChain === toChain ? 0.1 : 0.3;
    const amountBigInt = BigInt(amount);
    const feeAmount = (amountBigInt * BigInt(Math.floor(baseFeePercentage * 100))) / BigInt(10000);
    
    return {
      amount: feeAmount.toString(),
      token: 'native',
      percentage: baseFeePercentage.toString()
    };
  }

  /**
   * Calculate price impact
   */
  private calculatePriceImpact(
    inputAmount: string, 
    outputAmount: string, 
    rate: string, 
    fromDecimals: number = 18,
    toDecimals: number = 18
  ): string {
    const inputBigInt = BigInt(inputAmount);
    const outputBigInt = BigInt(outputAmount);
    const rateBigInt = BigInt(rate);
    
    // Use appropriate decimals for calculation
    const decimalAdjustment = Math.max(fromDecimals, toDecimals);
    const expectedOutput = (inputBigInt * rateBigInt) / BigInt(10 ** decimalAdjustment);
    
    // Handle zero division case
    if (expectedOutput === BigInt(0)) {
      return "0";
    }
    
    const impact = ((expectedOutput - outputBigInt) * BigInt(10000)) / expectedOutput;
    
    return (Number(impact) / 100).toString();
  }

  /**
   * Estimate gas usage
   */
  private estimateGasUsage(fromChain: string, toChain: string): string {
    // Base gas estimates
    const baseGas = fromChain === toChain ? 150000 : 250000;
    return baseGas.toString();
  }

  /**
   * Get optimal route
   */
  private async getOptimalRoute(request: QuoteRequest): Promise<{
    fromToken: string;
    toToken: string;
    exchange: string;
    portion: number;
  }[]> {
    // Mock route for now
    return [
      {
        fromToken: request.fromToken,
        toToken: request.toToken,
        exchange: 'FusionBridge',
        portion: 1.0
      }
    ];
  }

  /**
   * Generate unique quote ID
   */
  private generateQuoteId(): string {
    return `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize token prices
   */
  private initializeTokenPrices(): void {
    // Mock token prices
    this.tokenPrices.set('ETH', {
      token: 'ETH',
      price: '2000000000000000000000', // $2000
      decimals: 18,
      symbol: 'ETH'
    });

    this.tokenPrices.set('USDC', {
      token: 'USDC',
      price: '1000000', // $1
      decimals: 6,
      symbol: 'USDC'
    });

    this.tokenPrices.set('XLM', {
      token: 'XLM',
      price: '100000000', // $0.1
      decimals: 7,
      symbol: 'XLM'
    });
  }

  /**
   * Fetch token price from oracle
   */
  private async fetchTokenPriceFromOracle(token: string): Promise<TokenPrice> {
    // Mock implementation
    return {
      token,
      price: '1000000000000000000', // $1
      decimals: 18,
      symbol: token
    };
  }

  /**
   * Clean up expired quotes
   */
  cleanupExpiredQuotes(): void {
    const now = getCurrentTimestamp();
    for (const [quoteId, quote] of this.quotes) {
      if (quote.validUntil <= now) {
        this.quotes.delete(quoteId);
      }
    }
  }
}

// Singleton instance
export const quoterService = new QuoterService();

export default QuoterService; 