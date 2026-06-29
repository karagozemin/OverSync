import { useState, useEffect, useMemo } from 'react';
import { 
  Horizon, 
  Asset, 
  Operation, 
  TransactionBuilder, 
  Memo
} from '@stellar/stellar-sdk';
import { isTestnet, getCurrentNetwork } from '../config/networks';
import type { NetworkModeState } from '../lib/useNetworkMode';
import { parseHtlcReceipt } from '../lib/parseHtlcReceipt';
import { sanitizeAmountInput } from '../lib/sanitizeAmountInput';
import { AlertTriangle, ArrowDownUp, CheckCircle2, Loader2, RefreshCw, Settings2 } from 'lucide-react';

// Web3 imports for contract interaction
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      selectedAddress?: string;
    };
  }
}

interface BridgeFormProps {
  ethAddress: string;
  stellarAddress: string;
  signStellarTransaction: (xdr: string, networkPassphrase?: string) => Promise<string>;
  /** Network/wallet mismatch detector from App. If omitted, guardrails are skipped. */
  networkState?: NetworkModeState;
}

  // Fixed token information
const ETH_TOKEN = {
  symbol: 'ETH',
  name: 'Ethereum',
  logo: '/images/eth.png',
  chain: 'Ethereum',
  decimals: 18
};

const XLM_TOKEN = {
  symbol: 'XLM',
  name: 'Stellar Lumens',
  logo: '/images/xlm.png',
  chain: 'Stellar',
  decimals: 7
};

  // Fixed exchange rate (in real application, this would be fetched from API)
const ETH_TO_XLM_RATE = 10000; // 1 ETH = 10,000 XLM

// Network configuration
const MAINNET_CHAIN_ID = '0x1'; // Ethereum Mainnet (1)

// Helper function to save transaction to localStorage for history
const saveTransactionToHistory = (transaction: {
  orderId: string;
  txHash: string;
  direction: 'eth-to-xlm' | 'xlm-to-eth';
  amount: string;
  estimatedAmount: string;
  ethAddress: string;
  stellarAddress: string;
  ethTxHash?: string;
  stellarTxHash?: string;
  status?: 'pending' | 'completed' | 'failed' | 'cancelled';
  // Optional on-chain metadata so TransactionHistory can offer a Refund button
  // for ETH→XLM swaps once the timelock expires.
  onChainOrderId?: string;
  htlcContractAddress?: string;
  htlcContractMode?: 'v1-mainnet-htlc' | 'v2-escrow';
  timelockUnixSeconds?: number;
  amountWei?: string;
}) => {
  try {
    // Get current network info to determine correct network names
    const isTestnetMode = isTestnet();
    
    const historyTransaction = {
      id: transaction.orderId,
      txHash: transaction.txHash,
      fromNetwork: transaction.direction === 'eth-to-xlm' 
        ? (isTestnetMode ? 'ETH Sepolia' : 'ETH Mainnet') 
        : (isTestnetMode ? 'Stellar Testnet' : 'Stellar Mainnet'),
      toNetwork: transaction.direction === 'eth-to-xlm' 
        ? (isTestnetMode ? 'Stellar Testnet' : 'Stellar Mainnet') 
        : (isTestnetMode ? 'ETH Sepolia' : 'ETH Mainnet'),
      fromToken: transaction.direction === 'eth-to-xlm' ? 'ETH' : 'XLM',
      toToken: transaction.direction === 'eth-to-xlm' ? 'XLM' : 'ETH',
      amount: transaction.amount,
      estimatedAmount: transaction.estimatedAmount,
      ethAddress: transaction.ethAddress,
      stellarAddress: transaction.stellarAddress,
      status: transaction.status || 'pending',
      timestamp: Date.now(),
      ethTxHash: transaction.ethTxHash,
      stellarTxHash: transaction.stellarTxHash,
      direction: transaction.direction,
      onChainOrderId: transaction.onChainOrderId,
      htlcContractAddress: transaction.htlcContractAddress,
      htlcContractMode: transaction.htlcContractMode,
      timelockUnixSeconds: transaction.timelockUnixSeconds,
      amountWei: transaction.amountWei,
      networkMode: (isTestnetMode ? 'testnet' : 'mainnet') as 'testnet' | 'mainnet',
    };

    // Get existing transactions
    const existing = localStorage.getItem('oversync_transactions_v2');
    const transactions = existing ? JSON.parse(existing) : [];
    
    // Add new transaction
    transactions.unshift(historyTransaction); // Add to beginning
    
    // Keep only last 50 transactions
    if (transactions.length > 50) {
      transactions.splice(50);
    }
    
    // Save back to localStorage
    localStorage.setItem('oversync_transactions_v2', JSON.stringify(transactions));
    
    console.log('💾 Transaction saved to history:', historyTransaction);
  } catch (error) {
    console.error('❌ Failed to save transaction to history:', error);
  }
};

// Helper function to update transaction status in localStorage
const updateTransactionStatus = (orderId: string, status: 'pending' | 'completed' | 'failed' | 'cancelled', additionalData?: any) => {
  try {
    const existing = localStorage.getItem('oversync_transactions_v2');
    if (existing) {
      const transactions = JSON.parse(existing);
      const transactionIndex = transactions.findIndex((tx: any) => tx.id === orderId);
      
      if (transactionIndex !== -1) {
        transactions[transactionIndex].status = status;
        
        // Add additional data if provided
        if (additionalData) {
          Object.assign(transactions[transactionIndex], additionalData);
        }
        
        // Save back to localStorage
        localStorage.setItem('oversync_transactions_v2', JSON.stringify(transactions));
        
        console.log(`💾 Transaction status updated: ${orderId} -> ${status}`);
      } else {
        console.log(`⚠️ Transaction not found for status update: ${orderId}`);
      }
    }
  } catch (error) {
    console.error('❌ Failed to update transaction status:', error);
  }
};

const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111 in hex
const PRODUCTION_API_BASE_URL = 'https://oversync-k36vx.ondigitalocean.app';
const API_BASE_URL = import.meta.env.PROD
  ? ''
  : import.meta.env.VITE_API_BASE_URL || PRODUCTION_API_BASE_URL;
const ENABLE_MOCK_DATA = import.meta.env.VITE_ENABLE_MOCK_DATA === 'true';

export default function BridgeForm({ ethAddress, stellarAddress, signStellarTransaction, networkState }: BridgeFormProps) {
  const [direction, setDirection] = useState<'eth_to_xlm' | 'xlm_to_eth'>('eth_to_xlm');
  const [networkInfo, setNetworkInfo] = useState(() => {
    const currentNetwork = getCurrentNetwork();
    const isTestnetMode = isTestnet();
    
    return {
      isTestnet: isTestnetMode,
      ethereum: currentNetwork.ethereum,
      stellar: currentNetwork.stellar,
      expectedChainId: isTestnetMode ? SEPOLIA_CHAIN_ID : MAINNET_CHAIN_ID
    };
  });

  // Update network info when network changes
  useEffect(() => {
    const updateNetworkInfo = () => {
      const currentNetwork = getCurrentNetwork();
      const isTestnetMode = isTestnet();
      
      setNetworkInfo({
        isTestnet: isTestnetMode,
        ethereum: currentNetwork.ethereum,
        stellar: currentNetwork.stellar,
        expectedChainId: isTestnetMode ? SEPOLIA_CHAIN_ID : MAINNET_CHAIN_ID
      });
    };

    // Update immediately
    updateNetworkInfo();

    // Listen for URL changes (network parameter)
    const handleUrlChange = () => {
      updateNetworkInfo();
    };

    // Listen for popstate (browser back/forward)
    window.addEventListener('popstate', handleUrlChange);
    
    // Listen for network changes every second
    const interval = setInterval(updateNetworkInfo, 1000);
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      clearInterval(interval);
    };
  }, []);
  const [amount, setAmount] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderCreated, setOrderCreated] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [balance, setBalance] = useState<string>('0');
  
  // Real-time exchange rate state.
  //
  // Quotes come from the relayer's /api/prices endpoint, which proxies
  // CoinGecko through a stale-while-revalidate cache (fresh for 15s, served
  // stale up to 60s while a background refresh runs). We deliberately do NOT
  // call CoinGecko from the browser any more — that path is blocked by CORS
  // in production and used to silently fall back to a hardcoded 10,000
  // XLM/ETH rate, which diverged from what the relayer actually settled at
  // swap time. That is the bug behind "I expected 0.07 ETH but only got
  // 0.024 ETH" reports.
  const [exchangeRate, setExchangeRate] = useState<number>(ETH_TO_XLM_RATE);
  const [xlmUsdPrice, setXlmUsdPrice] = useState<number | null>(null);
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null);
  const [priceSource, setPriceSource] = useState<'coingecko' | 'cache' | 'fallback' | null>(null);
  const [isLoadingRate, setIsLoadingRate] = useState(false);
  const [rateLastUpdated, setRateLastUpdated] = useState<Date | null>(null);
  
  // From ve To tokenları
  const fromToken = direction === 'eth_to_xlm' ? ETH_TOKEN : XLM_TOKEN;
  const toToken = direction === 'eth_to_xlm' ? XLM_TOKEN : ETH_TOKEN;

  // Fetch balance when direction or addresses change
  useEffect(() => {
    let cancelled = false;

    const fetchEthBalance = async (addr: string): Promise<string> => {
      if (!window.ethereum) {
        throw new Error('MetaMask not available');
      }
      const ethBalance = await window.ethereum.request({
        method: 'eth_getBalance',
        params: [addr, 'latest']
      });
      const balanceInEth = (parseInt(ethBalance, 16) / Math.pow(10, 18)).toFixed(4);
      return balanceInEth;
    };

    const fetchXlmBalance = async (addr: string): Promise<string> => {
      const horizonUrl = networkInfo.stellar.horizonUrl;
      const response = await fetch(`${horizonUrl}/accounts/${addr}`);
      if (!response.ok) {
        // Account may not exist yet (404), return 0
        if (response.status === 404) {
          return '0.0000';
        }
        throw new Error(`Stellar API error: ${response.status}`);
      }
      const accountData = await response.json();
      const xlmBalance = accountData.balances.find((b: any) => b.asset_type === 'native')?.balance || '0';
      return parseFloat(xlmBalance).toFixed(4);
    };

    const loadBalance = async () => {
      console.log('🔄 Loading balance for direction:', direction);

      if (direction === 'eth_to_xlm' && ethAddress) {
        setBalance('Loading...');
        try {
          const bal = await fetchEthBalance(ethAddress);
          if (!cancelled) {
            console.log('✅ ETH balance loaded:', bal);
            setBalance(bal);
          }
        } catch (err: any) {
          console.error('❌ ETH balance fetch failed:', err);
          if (!cancelled) setBalance('0');
        }
      } else if (direction === 'xlm_to_eth' && stellarAddress) {
        setBalance('Loading...');
        try {
          const bal = await fetchXlmBalance(stellarAddress);
          if (!cancelled) {
            console.log('✅ XLM balance loaded:', bal);
            setBalance(bal);
          }
        } catch (err: any) {
          console.error('❌ XLM balance fetch failed:', err);
          if (!cancelled) setBalance('0');
        }
      } else {
        setBalance('0');
      }
    };

    loadBalance();

    return () => {
      cancelled = true;
    };
  }, [direction, ethAddress, stellarAddress, networkInfo.stellar.horizonUrl]);
  
  // Fetch live prices from the relayer whenever the user is about to need a
  // quote. The relayer caches CoinGecko responses for 60s, so a flurry of
  // keystrokes ends up as at most one network round-trip per minute. We use a
  // ref-less cancelled flag to discard responses for stale renders.
  useEffect(() => {
    if (!amount || isNaN(parseFloat(amount))) {
      setEstimatedAmount('');
      return;
    }

    let cancelled = false;

    const computeWith = (rate: number) => {
      const inputAmount = parseFloat(amount);
      if (direction === 'eth_to_xlm') {
        const xlmAmount = inputAmount * rate;
        setEstimatedAmount(xlmAmount.toFixed(2));
      } else {
        const ethAmount = inputAmount / rate;
        setEstimatedAmount(ethAmount.toFixed(6));
      }
    };

    const updateRateAndCalculate = async () => {
      setIsLoadingRate(true);

      try {
        const res = await fetch(`${API_BASE_URL}/api/prices`);
        if (!res.ok) throw new Error(`prices endpoint returned ${res.status}`);
        const body = await res.json();

        const xlmPerEth = Number(body?.xlmPerEth);
        const ethUsd = Number(body?.ethUsd);
        const xlmUsd = Number(body?.xlmUsd);

        if (
          !Number.isFinite(xlmPerEth) || xlmPerEth <= 0 ||
          !Number.isFinite(ethUsd) || ethUsd <= 0 ||
          !Number.isFinite(xlmUsd) || xlmUsd <= 0
        ) {
          throw new Error('prices endpoint returned malformed data');
        }

        if (cancelled) return;

        setExchangeRate(xlmPerEth);
        setEthUsdPrice(ethUsd);
        setXlmUsdPrice(xlmUsd);
        setPriceSource(body?.source ?? 'coingecko');
        setRateLastUpdated(new Date(body?.fetchedAt ?? Date.now()));
        computeWith(xlmPerEth);
      } catch (err) {
        if (cancelled) return;
        // Backend unreachable — fall back to the hardcoded rate but make it
        // obvious in the UI so the user does not get a misleading estimate.
        console.warn('Falling back to hardcoded rate (relayer /api/prices unavailable):', err);
        setExchangeRate(ETH_TO_XLM_RATE);
        setEthUsdPrice(null);
        setXlmUsdPrice(null);
        setPriceSource('fallback');
        setRateLastUpdated(new Date());
        computeWith(ETH_TO_XLM_RATE);
      } finally {
        if (!cancelled) setIsLoadingRate(false);
      }
    };

    updateRateAndCalculate();

    return () => {
      cancelled = true;
    };
  }, [amount, direction]);
  
  // Yön değiştirme
  const handleSwapDirection = () => {
    setDirection(prev => prev === 'eth_to_xlm' ? 'xlm_to_eth' : 'eth_to_xlm');
    setAmount('');
    setEstimatedAmount('');
  };

  // Form gönderimi - RELAYER API ÜZERİNDEN
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Log transaction details
    console.log('🚀 Transaction Started:', { 
      direction: direction === 'eth_to_xlm' ? 'ETH → XLM' : 'XLM → ETH',
      amount,
      from: direction === 'eth_to_xlm' ? ethAddress : stellarAddress,
      to: direction === 'eth_to_xlm' ? stellarAddress : ethAddress
    });
    
    if (!amount || !ethAddress || !stellarAddress) {
      console.error('❌ Missing required fields');
              alert('Please fill all fields and connect wallets.');
      return;
    }
    
    if (!window.ethereum) {
      alert('MetaMask bulunamadı! Lütfen MetaMask yükleyin.');
      return;
    }

    // Guard: network mismatch — should be caught by the disabled button too,
    // but check again at submission time for defence in depth.
    if (networkState?.hasAnyMismatch) {
      const reason =
        networkState.metamaskConnected && !networkState.metamaskMatches
          ? `MetaMask is on the wrong network (expected ${networkState.mode === 'testnet' ? 'Sepolia' : 'Mainnet'}).`
          : networkState.freighterConnected && !networkState.freighterMatches
            ? `Freighter is on the wrong Stellar network (expected ${networkState.mode === 'testnet' ? 'Testnet' : 'Mainnet'}).`
            : 'Wallet network does not match the selected chain pair.';
      alert(`Network mismatch: ${reason} Please switch wallets and try again.`);
      setIsSubmitting(false);
      setStatusMessage('');
      return;
    }
    
    setIsSubmitting(true);
    setStatusMessage('Hazırlanıyor...');
    
    let result: any;
    
    try {
      // Check network and switch if needed
      console.log('🔗 Checking network...');
      console.log('🔗 Expected network info:', networkInfo);
      
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      console.log('🔗 Current chain ID:', chainId);
      console.log('🔗 Expected chain ID:', networkInfo.expectedChainId);
      
      if (chainId !== networkInfo.expectedChainId) {
        const networkName = networkInfo.isTestnet ? 'Sepolia Testnet' : 'Ethereum Mainnet';
        console.log(`🔗 Switching to ${networkName}...`);
        
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: networkInfo.expectedChainId }],
          });
          console.log(`✅ Successfully switched to ${networkName}`);
        } catch (switchError: any) {
          console.log('🔄 Network switch error:', switchError);
          if (switchError.code === 4902) {
            // Network not added yet
            const networkConfig = networkInfo.isTestnet ? {
                chainId: SEPOLIA_CHAIN_ID,
                chainName: 'Sepolia Testnet',
                rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
                nativeCurrency: {
                  name: 'SepoliaETH',
                  symbol: 'SEP',
                  decimals: 18
                }
            } : {
              chainId: MAINNET_CHAIN_ID,
              chainName: 'Ethereum Mainnet',
              rpcUrls: ['https://ethereum-rpc.publicnode.com'],
              blockExplorerUrls: ['https://etherscan.io'],
              nativeCurrency: {
                name: 'Ether',
                symbol: 'ETH',
                decimals: 18
              }
            };
            
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [networkConfig],
            });
            console.log(`✅ Successfully added and switched to ${networkName}`);
          } else {
            console.error('❌ Network switch failed:', switchError);
            alert(`Please switch MetaMask to ${networkName} manually and try again.`);
            setIsSubmitting(false);
            setStatusMessage('');
            return;
          }
        }
      } else {
        console.log('✅ Network is already correct');
      }

      // Create order request (used by both testnet and mainnet)
      console.log('📋 BEFORE orderRequest creation:', {
        'AMOUNT_BEFORE_REQUEST': amount,
        'AMOUNT_TYPE': typeof amount,
        'EXCHANGE_RATE': exchangeRate,
        'DIRECTION': direction
      });
      
      const orderRequest = {
        fromChain: direction === 'eth_to_xlm' ? 'ethereum' : 'stellar',
        toChain: direction === 'eth_to_xlm' ? 'stellar' : 'ethereum',
        fromToken: direction === 'eth_to_xlm' ? 'ETH' : 'XLM',
        toToken: direction === 'eth_to_xlm' ? 'XLM' : 'ETH',
        amount: amount,
        ethAddress: ethAddress,
        stellarAddress: stellarAddress,
        direction: direction,
        exchangeRate: exchangeRate, // Include real-time rate
        networkMode: networkInfo.isTestnet ? 'testnet' : 'mainnet' // DYNAMIC NETWORK
      };
      
      console.log('📋 AFTER orderRequest creation:', {
        'orderRequest.amount': orderRequest.amount,
        'orderRequest_full': orderRequest
      });
      
      if (networkInfo.isTestnet) {
        // TESTNET: Use existing relayer system
        console.log('🔄 Creating bridge order via Relayer API (Testnet)...');
        setStatusMessage('Creating order...');
      
      console.log('📋 Order request:', orderRequest);
      
      // Send request to relayer
      const response = await fetch(`${API_BASE_URL}/api/orders/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderRequest)
      });
      
      console.log('📥 API Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ API Error:', errorData);
        throw new Error(errorData.error || `API Error: ${response.status}`);
      }
      
        result = await response.json();
      console.log('✅ Order created via relayer:', result);

            } else {
        // MAINNET: Relayer handles 1inch integration
        console.log('🔄 Creating bridge order via Relayer API (Mainnet)...');
        setStatusMessage('Creating mainnet order...');
        
        // Send request to relayer (same as testnet)
        const response = await fetch(`${API_BASE_URL}/api/orders/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(orderRequest)
        });
        
        console.log('📥 Mainnet API Response status:', response.status);
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error('❌ Mainnet API Error:', errorData);
          throw new Error(errorData.error || `Mainnet API Error: ${response.status}`);
        }
        
        result = await response.json();
        console.log('✅ Mainnet order created via relayer:', result);
      }
      
      // Handle different transaction types based on direction
      if (direction === 'eth_to_xlm' && (result.approvalTransaction || result.proxyTransaction)) {
        // ETH → XLM: Use MetaMask for ETH transaction
        console.log('🔄 Requesting ETH approval transaction...');
        console.log('📋 Instructions:', result.instructions);
        
        // Use proxyTransaction if available, fallback to approvalTransaction
        const transactionData = result.proxyTransaction || result.approvalTransaction;
        
        try {
          // Validate transaction parameters
          if (!transactionData.to || !transactionData.value) {
            throw new Error('Invalid transaction parameters from relayer');
          }

          // Log transaction details for debugging
          console.log('🔍 Transaction details (CONTRACT INTERACTION):', {
            ...transactionData,
            from: ethAddress
          });
          
          // Check user balance first
          const balance = await window.ethereum.request({
            method: 'eth_getBalance',
            params: [ethAddress, 'latest']
          });
          console.log('💰 User balance:', balance);
          
          // Additional balance checks
          const balanceWei = BigInt(balance);
          const valueWei = BigInt(transactionData.value);
          const estimatedGasCost = BigInt('0x5208') * BigInt('20000000000'); // Rough estimate
          
          console.log('💰 Balance Analysis:', {
            balanceETH: (Number(balanceWei) / 1e18).toFixed(6),
            requiredETH: (Number(valueWei) / 1e18).toFixed(6),
            estimatedGasCostETH: (Number(estimatedGasCost) / 1e18).toFixed(6),
            totalNeededETH: (Number(valueWei + estimatedGasCost) / 1e18).toFixed(6),
            hasSufficientBalance: balanceWei >= (valueWei + estimatedGasCost)
          });
          
          // Estimate gas if not provided by relayer
          let gasLimit = transactionData.gas;
          if (!gasLimit) {
            try {
              const estimatedGas = await window.ethereum.request({
                method: 'eth_estimateGas',
                params: [{
                  ...transactionData,
                  from: ethAddress
                }]
              });
              gasLimit = `0x${Math.floor(parseInt(estimatedGas, 16) * 1.2).toString(16)}`; // Add 20% buffer
              console.log('⛽ Estimated gas:', estimatedGas, 'Using:', gasLimit);
            } catch (gasError) {
              console.warn('⚠️ Gas estimation failed, using fallback:', gasError);
              gasLimit = '0x493E0'; // 300000 fallback for contract interaction
            }
          }
          
          // ESCROW FACTORY DIRECT MODE: Using direct contract interaction
          console.log('🏭 ESCROW FACTORY DIRECT MODE: Using direct contract transaction');
          console.log('📋 Transaction details:', {
            ...transactionData,
            from: ethAddress,
            gas: gasLimit
          });
          
          const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
              ...transactionData,
              from: ethAddress,
              gas: gasLimit
            }],
          });
          
          // ALWAYS log transaction details (production too)
          console.log('✅ ETH Transaction Sent!');
          console.log('📋 TX Hash:', txHash);
          console.log('🔗 View on Etherscan:', `${networkInfo.ethereum.explorerUrl}/tx/${txHash}`);
          
          // Update UI status
          setStatusMessage('Gönderiliyor...');
          setIsSubmitting(true);
          
          // Update status to confirmation waiting
          setStatusMessage('Confirming...');
          
          // Wait for transaction receipt to confirm success
          let receipt = null;
          let attempts = 0;
          const maxAttempts = 120; // Wait max 2 minutes (1s * 120 = 120s)
          
          while (!receipt && attempts < maxAttempts) {
            try {
              // First try to get transaction status
              const txStatus = await window.ethereum.request({
                method: 'eth_getTransactionByHash',
                params: [txHash]
              });
              
              if (txStatus && txStatus.blockNumber) {
                console.log('✅ Transaction confirmed via block number!');
                receipt = { status: '0x1' }; // Assume success if confirmed
                break;
              }
              
              // Then try to get receipt
              receipt = await window.ethereum.request({
                method: 'eth_getTransactionReceipt',
                params: [txHash]
              });
              
              if (!receipt) {
                // Only log every 10 attempts to reduce spam
                if ((attempts + 1) % 10 === 0 || attempts === 0) {
                  console.log(`⏳ Waiting for confirmation... (${attempts + 1}/${maxAttempts})`);
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                attempts++;
              } else {
                console.log('✅ Transaction receipt found!');
                break;
              }
            } catch (receiptError) {
              console.warn('⚠️ Error getting receipt:', receiptError);
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
          
          if (!receipt) {
            // Try alternative method - check transaction status directly
            console.log('🔄 Receipt not found, trying alternative confirmation method...');
            
            try {
              const txStatus = await window.ethereum.request({
                method: 'eth_getTransactionByHash',
                params: [txHash]
              });
              
              if (txStatus && txStatus.blockNumber) {
                console.log('✅ Transaction confirmed via alternative method!');
                receipt = { status: '0x1' }; // Assume success if confirmed
              } else {
                throw new Error('Transaction confirmation timeout');
              }
            } catch (altError) {
              console.error('❌ Alternative confirmation also failed:', altError);
              throw new Error('Transaction confirmation timeout');
            }
          }
          
          // Check transaction status
          const isSuccess = receipt.status === '0x1';
          console.log('📋 Transaction status:', receipt.status, isSuccess ? '✅ SUCCESS' : '❌ FAILED');
          
          if (!isSuccess) {
            throw new Error('Transaction failed on blockchain');
          }
          
          console.log('✅ Transaction confirmed successfully!');
          console.log('🤖 Now triggering cross-chain processing...');

          // Pull the full receipt (we may have only a {status} stub from the
          // alt-path above). Logs are required to parse refund metadata.
          let refundMeta: ReturnType<typeof parseHtlcReceipt> = null;
          try {
            const fullReceipt = await window.ethereum?.request({
              method: 'eth_getTransactionReceipt',
              params: [txHash],
            });
            refundMeta = parseHtlcReceipt(fullReceipt?.logs);
            if (refundMeta) {
              console.log('🛡️ Refund metadata captured:', refundMeta);
            } else {
              console.warn('⚠️ No HTLC OrderCreated event in receipt; refund button will be hidden for this tx.');
            }
          } catch (parseErr) {
            console.warn('⚠️ Failed to load full receipt for refund metadata:', parseErr);
          }

          // Save transaction to history immediately when ETH tx confirms
          saveTransactionToHistory({
            orderId: result.orderId,
            txHash: txHash,
            direction: 'eth-to-xlm',
            amount: amount,
            estimatedAmount: estimatedAmount,
            ethAddress: ethAddress,
            stellarAddress: stellarAddress,
            ethTxHash: txHash,
            status: 'pending', // Initial status, will update after processing
            onChainOrderId: refundMeta?.orderId,
            htlcContractAddress: refundMeta?.contractAddress,
            htlcContractMode: refundMeta?.contractMode,
            timelockUnixSeconds: refundMeta?.timelockUnixSeconds,
            amountWei: refundMeta?.amountWei,
          });
          
          // Update status to cross-chain processing
          setStatusMessage('Bridging...');
          
          // Show success with transaction hash
          setOrderId(txHash);
          setOrderCreated(true);
          
          // ONLY process if Ethereum transaction was successful
          console.log('⚡ Triggering cross-chain processing after successful ETH tx...');
          
          // Debug: Check order data before processing
          console.log('🔍 DEBUG Process Request:', {
            resultOrderId: result.orderId,
            resultOrderIdType: typeof result.orderId,
            txHash: txHash,
            txHashType: typeof txHash,
            stellarAddress: stellarAddress,
            ethAddress: ethAddress,
            fullResult: result
          });
          
          try {
            const processResponse = await fetch(`${API_BASE_URL}/api/orders/process`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                orderId: result.orderId,
                txHash: txHash,
                stellarAddress: stellarAddress,
                ethAddress: ethAddress
              })
            });
            
            if (processResponse.ok) {
              const processResult = await processResponse.json();
              console.log('✅ Cross-chain processing initiated:', processResult);
              console.log('🌟 Stellar transaction:', processResult.stellarTxId);
              console.log('💫 Expected XLM amount:', processResult.details?.stellar?.amount);
              
              // Update transaction status to completed
              updateTransactionStatus(result.orderId, 'completed', {
                stellarTxHash: processResult.stellarTxId
              });
              
              console.log('🎉 Cross-Chain Bridge Completed!');
              console.log('📋 Stellar TX:', processResult.stellarTxId);
              
              // Update status to completed
              setStatusMessage('Tamamlandı ✅');
              setIsSubmitting(false);
            } else {
              console.error('❌ Processing request failed:', processResponse.status);

              if (ENABLE_MOCK_DATA) {
                console.log('🧪 Mock data enabled: showing success despite processing failure');
                updateTransactionStatus(result.orderId, 'completed');
                setStatusMessage('Completed ✅');
                setIsSubmitting(false);
                setOrderId(txHash);
                setOrderCreated(true);
              } else {
                updateTransactionStatus(result.orderId, 'failed');
                setStatusMessage('İşlem başarısız ❌');
                setIsSubmitting(false);
              }
            }
          } catch (processError) {
            console.error('❌ Processing request error:', processError);

            if (ENABLE_MOCK_DATA) {
              console.log('🧪 Mock data enabled: showing success despite processing error');
              updateTransactionStatus(result.orderId, 'completed');
              setStatusMessage('Completed ✅');
              setIsSubmitting(false);
              setOrderId(txHash);
              setOrderCreated(true);
            } else {
              updateTransactionStatus(result.orderId, 'failed');
              setStatusMessage('İşlem başarısız ❌');
              setIsSubmitting(false);
            }
          }
          
          // Store transaction details for tracking
          console.log('Order approved:', {
            orderId: result.orderId,
            approvalTxHash: txHash,
            fromToken,
            toToken,
            amount,
            estimatedAmount,
            ethAddress,
            stellarAddress,
            direction,
            message: result.message,
            nextStep: result.nextStep
          });
          
        } catch (txError: any) {
          console.error('❌ Approval transaction failed:', txError);
          
          // Update status to failed
          setStatusMessage('Failed ❌');
          setIsSubmitting(false);
          
          console.error('🔍 Full error details:', {
            code: txError.code,
            message: txError.message,
            data: txError.data,
            stack: txError.stack
          });
          
          // Handle MetaMask errors with more specific messages
          if (txError.code === 4001) {
            alert('Transaction was rejected by user');
          } else if (txError.code === -32603) {
            alert('Transaction failed. Please check your balance and try again.');
          } else if (txError.code === -32000) {
            alert('Insufficient funds for gas * price + value');
          } else if (txError.code === -32602) {
            alert('Invalid transaction parameters');
          } else {
            const errorMsg = txError.message || txError.reason || 'Unknown error occurred';
            alert(`Transaction error: ${errorMsg}`);
          }
          return; // Don't show success if transaction failed
        }
      } else if (direction === 'xlm_to_eth') {
        // XLM → ETH: Use Freighter for Stellar transaction
        console.log('🔄 Creating Stellar payment transaction...');
        console.log('💰 Sending', result.orderData.stellarAmount, 'stroops to relayer');
        
        try {
          // Use network configuration to determine correct Horizon URL and network
          const stellarServer = new Horizon.Server(networkInfo.stellar.horizonUrl);
          const stellarNetworkPassphrase = networkInfo.stellar.networkPassphrase;
          const relayerStellarAddress = result.orderData.stellarAddress; // Use relayer provided address
          
          console.log(`🔗 Using Stellar ${networkInfo.isTestnet ? 'testnet' : 'mainnet'}:`, {
            horizonUrl: networkInfo.stellar.horizonUrl,
            networkPassphrase: stellarNetworkPassphrase,
            relayerAddress: relayerStellarAddress,
            memo: result.orderData.memo
          });
          
          // Get user's account to build transaction
          const userAccount = await stellarServer.loadAccount(stellarAddress);
          
          // Create payment to relayer using exact amounts from relayer
          const xlmAmount = (parseInt(result.orderData.stellarAmount) / 10000000).toFixed(7); // Convert stroops to XLM
          const payment = Operation.payment({
            destination: relayerStellarAddress,
            asset: Asset.native(), // XLM
            amount: xlmAmount
          });
          
          console.log('💰 Payment details:', {
            destination: relayerStellarAddress,
            amount: xlmAmount + ' XLM',
            stroops: result.orderData.stellarAmount,
            memo: result.orderData.memo
          });

          // Build transaction with correct network
          const transaction = new TransactionBuilder(userAccount, {
            fee: '100', // Normal Stellar fee (100 stroops)
            networkPassphrase: stellarNetworkPassphrase
          })
            .addOperation(payment)
            .addMemo(Memo.text(result.orderData.memo)) // Use exact memo from relayer
            .setTimeout(300)
            .build();

          console.log('📝 Signing transaction with Freighter...');
          
          // Sign with Freighter using correct network
          const signedXdr = await signStellarTransaction(transaction.toXDR(), stellarNetworkPassphrase);
          
          console.log('✅ Stellar transaction signed!');
          
          // Submit signed transaction to Stellar network
          const signedTx = TransactionBuilder.fromXDR(signedXdr, stellarNetworkPassphrase);
          const submitResult = await stellarServer.submitTransaction(signedTx);
          
          // ALWAYS log transaction details (production too)
          console.log('✅ Stellar Transaction Sent!');
          console.log('📋 TX Hash:', submitResult.hash);
          console.log('🔗 View on Stellar:', `${networkInfo.stellar.explorerUrl}/tx/${submitResult.hash}`);
          
          // Save transaction to history immediately when XLM tx submits
          saveTransactionToHistory({
            orderId: result.orderId,
            txHash: submitResult.hash,
            direction: 'xlm-to-eth',
            amount: amount,
            estimatedAmount: estimatedAmount,
            ethAddress: ethAddress,
            stellarAddress: stellarAddress,
            stellarTxHash: submitResult.hash,
            status: 'pending' // Initial status, will update after ETH processing
          });
          
          // Show success
          setOrderId(submitResult.hash);
          setOrderCreated(true);
          
          // Process the order on backend
          console.log('⚡ Triggering ETH release...');
          
          const requestBody = {
            orderId: result.orderId,
            stellarTxHash: submitResult.hash,
            stellarAddress: stellarAddress,
            ethAddress: ethAddress,
            networkMode: networkInfo.isTestnet ? 'testnet' : 'mainnet'  // ✅ Send network mode to backend
          };
          
          console.log('🔍 FRONTEND DEBUG: XLM→ETH request body:', JSON.stringify(requestBody, null, 2));
          console.log('🔍 FRONTEND DEBUG: API_BASE_URL:', API_BASE_URL);
          
          try {
            const processResponse = await fetch(`${API_BASE_URL}/api/orders/xlm-to-eth`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody)
            });
            
            if (processResponse.ok) {
              const processResult = await processResponse.json();
              console.log('✅ ETH release initiated:', processResult);
              console.log('💰 Expected ETH amount:', result.orderData?.targetAmount || 'unknown', 'wei');
              
              // Update transaction status to completed
              updateTransactionStatus(result.orderId, 'completed', {
                ethTxHash: processResult.ethTxId
              });
              
              console.log('🎉 Cross-Chain Bridge Completed!');
              console.log('📋 ETH TX:', processResult.ethTxId);
              
              // Update status to completed
              setStatusMessage('Completed ✅');
              setIsSubmitting(false);
              
            } else {
              const errorData = await processResponse.text();
              console.error('❌ ETH release failed:', processResponse.status);
              console.error('❌ Error response body:', errorData);
              
              // Try to parse error details
              let parsedError: any = null;
              try {
                parsedError = JSON.parse(errorData);
                console.error('❌ Parsed error details:', parsedError);
              } catch (parseError) {
                console.error('❌ Could not parse error response as JSON');
              }
              
              // Check if automatic refund was processed by backend
              if (parsedError?.refund?.status === 'completed') {
                console.log('✅ Automatic refund completed:', parsedError.refund.stellarTxHash);

                // Persist refund metadata so TransactionHistory can render a
                // "Refunded · view Stellar tx" link. We keep status=cancelled
                // (the swap didn't go through) but make the refund discoverable.
                updateTransactionStatus(result.orderId, 'cancelled', {
                  refundTxHash: parsedError.refund.stellarTxHash,
                  refundNetwork: 'stellar',
                  refundedAt: Date.now(),
                });
                
                setStatusMessage('Refunded ↩️');
                setIsSubmitting(false);
                
                alert(
                  `ETH transfer failed, but your XLM has been automatically refunded to your wallet.\n\n` +
                  `Refund TX: ${parsedError.refund.stellarTxHash}\n\n` +
                  `Reason: ${parsedError.details || 'Unknown'}`
                );
              } else {
                // Refund failed or not attempted - inform user with manual refund instructions
                console.error('❌ Automatic refund failed:', parsedError?.refund);
                
                updateTransactionStatus(result.orderId, 'failed', {
                  autoRefundFailed: parsedError?.refund?.status === 'failed',
                  autoRefundError: parsedError?.refund?.error,
                });
                
                setStatusMessage('Failed ❌');
                setIsSubmitting(false);
                
                const refundInfo = parsedError?.refund 
                  ? `\n\nAutomatic refund failed: ${parsedError.refund.error}\n\n` +
                    `To recover your XLM, contact support with:\n` +
                    `- Stellar TX: ${submitResult.hash}\n` +
                    `- Stellar Address: ${stellarAddress}`
                  : '';
                
                alert(`ETH sending failed: ${parsedError?.details || errorData}${refundInfo}`);
              }
            }
          } catch (processError: any) {
            console.error('❌ ETH release network error:', processError);
            console.error('❌ Error details:', {
              message: processError.message,
              name: processError.name,
              stack: processError.stack
            });
            
            // Update status to failed
                          setStatusMessage('Network error ❌');
            setIsSubmitting(false);
            
            // Update transaction status to failed
            updateTransactionStatus(result.orderId, 'failed');
            
            // Show error to user  
                          alert(`ETH sending network error: ${processError.message}`);
          }

        } catch (stellarError: any) {
          console.error('❌ Stellar transaction failed:', stellarError);
          
          // Handle Freighter errors
          if (stellarError.message?.includes('User declined')) {
            alert('Stellar transaction was rejected by user');
          } else {
            alert(`Stellar transaction error: ${stellarError.message || 'Unknown error occurred'}`);
          }
          return;
        }
      } else {
        // Fallback: show order created without transaction
        setOrderId(result.orderId);
        setOrderCreated(true);
        
        console.log('Order created (no transaction):', {
          orderId: result.orderId,
          fromToken,
          toToken,
          amount,
          estimatedAmount,
          ethAddress,
          stellarAddress,
          direction
        });
      }
      
    } catch (error: any) {
      console.error('❌ Error creating order:', error);
      
      // Show error message
      alert(`Error: ${error.message || 'Unknown error occurred'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form reset
  const handleReset = () => {
    setAmount('');
    setEstimatedAmount('');
    setOrderCreated(false);
    setOrderId(null);
  };

  // Check if wallets are connected
  const walletsConnected = ethAddress && stellarAddress;

  // ---- Network mismatch guardrails ----
  const mismatchInfo = useMemo(() => {
    const ns = networkState;
    if (!ns) return null;

    const evmMismatch = ns.metamaskConnected && !ns.metamaskMatches;
    const stellarMismatch = ns.freighterConnected && !ns.freighterMatches;
    const evmDisconnected = !ns.metamaskConnected;
    const stellarDisconnected = !ns.freighterConnected;

    let label: string | null = null;
    let severity: 'warning' | 'error' = 'warning';

    if (ns.hasAnyMismatch) {
      if (evmMismatch && stellarMismatch) {
        label = `Both wallets are on the wrong network. Switch MetaMask to ${ns.mode === 'testnet' ? 'Sepolia' : 'Mainnet'} and Freighter to ${ns.mode === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet'}.`;
        severity = 'error';
      } else if (evmMismatch) {
        const actual = ns.metamaskChainId?.toLowerCase() === '0x1' ? 'Mainnet' : 'a different network';
        label = `MetaMask is on ${actual} but the app is in ${ns.mode === 'testnet' ? 'Testnet' : 'Mainnet'} mode. Switch MetaMask to ${ns.mode === 'testnet' ? 'Sepolia' : 'Mainnet'}.`;
        severity = 'error';
      } else if (stellarMismatch) {
        label = `Freighter is on a different Stellar network. Switch Freighter to ${ns.mode === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet'} in the extension.`;
        severity = 'error';
      }
    }

    const blocked = ns.hasAnyMismatch;

    return { evmMismatch, stellarMismatch, evmDisconnected, stellarDisconnected, label, severity, blocked };
  }, [networkState]);

  const isBlocked = mismatchInfo?.blocked === true;
  const mismatchLabel = mismatchInfo?.label ?? null;
  // ---- end mismatch guardrails ----

  return (
    <div className="w-full rounded-[1.25rem] p-4 swap-card-bg swap-card-border md:p-5 lg:p-6">
      {orderCreated ? (
        <div className="space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-300/12 shadow-[0_18px_48px_rgba(16,185,129,0.18)]">
            <CheckCircle2 className="h-8 w-8 text-emerald-200" />
          </div>
          
          <div>
            <h3 className="mb-2 text-2xl font-semibold tracking-tight text-white">Order Created</h3>
            <p className="text-slate-300">
              Your cross-chain order has been successfully created and is now processing.
            </p>
          </div>
          
          <div className="surface-panel rounded-2xl p-4 text-left">
            <div className="mb-2">
              <span className="text-sm text-slate-400">Order ID:</span>
              <p className="font-mono text-white text-sm break-all">{orderId}</p>
            </div>
            <div className="mb-2">
              <span className="text-sm text-slate-400">From:</span>
              <p className="text-white">{amount} {fromToken.symbol}</p>
            </div>
            <div>
              <span className="text-sm text-slate-400">To:</span>
              <p className="text-white">{estimatedAmount} {toToken.symbol}</p>
            </div>
          </div>
          
          <div className="pt-4">
            <button
              onClick={handleReset}
              className="button-hover-scale brand-cta w-full rounded-full py-3 font-semibold transition"
            >
              New Bridge
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="mb-1 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-cyan-100/55">Bridge console</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-full border border-cyan-200/15 bg-white/[0.055] p-2 text-slate-300 transition hover:border-cyan-200/35 hover:bg-cyan-200/10 hover:text-cyan-50" title="Refresh quote">
                <RefreshCw className="h-4 w-4" />
              </button>
              <button type="button" className="rounded-full border border-cyan-200/15 bg-white/[0.055] p-2 text-slate-300 transition hover:border-cyan-200/35 hover:bg-cyan-200/10 hover:text-cyan-50" title="Bridge settings">
                <Settings2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* From Section */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/55">You pay</label>
            <div className="token-input-panel rounded-2xl p-3 input-container">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img
                    src={fromToken.logo}
                    alt={fromToken.symbol}
                    className="h-7 w-7 rounded-full"
                  />
                  <div>
                    <span className="font-medium text-white">{fromToken.symbol}</span>
                    <span className="ml-2 text-xs text-slate-400">on {fromToken.chain}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => {
                    setAmount(sanitizeAmountInput(e.target.value, fromToken.decimals));
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData('text');
                    setAmount(sanitizeAmountInput(pasted, fromToken.decimals));
                  }}
                  placeholder="0.0"
                  className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight text-white outline-none placeholder:text-slate-500"
                />
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const newAmount = (parseFloat(balance) * 0.5).toFixed(4);
                      console.log('🔘 50% Button clicked:', { balance, newAmount });
                      setAmount(newAmount);
                    }}
                    className="rounded-full border border-cyan-200/25 bg-cyan-200/[0.08] px-2.5 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-100/40 hover:bg-cyan-200/15"
                  >
                    50%
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      console.log('🔘 MAX Button clicked:', { balance });
                      setAmount(balance);
                    }}
                    className="rounded-full border border-cyan-200/25 bg-cyan-200/[0.08] px-2.5 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-100/40 hover:bg-cyan-200/15"
                  >
                    Max
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-sm text-slate-500">$0.00</div>
                <div className="truncate text-sm text-slate-400">
                  Balance: {balance} {fromToken.symbol}
                </div>
              </div>
            </div>
          </div>

          {/* Direction Button */}
          <div className="relative z-10 -my-2 flex justify-center">
            <button
              type="button"
              onClick={handleSwapDirection}
              className="button-hover-scale rounded-full border border-cyan-200/35 bg-[#081029] p-2.5 text-cyan-50 shadow-[0_14px_38px_rgba(0,0,0,0.4),0_0_24px_rgba(0,226,255,0.12)] transition hover:border-cyan-100/55 hover:bg-[#0d1735]"
            >
              <ArrowDownUp className="h-5 w-5" />
            </button>
          </div>

          {/* To Section */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/55">You receive</label>
            <div className="token-input-panel rounded-2xl p-3 input-container">
              <div className="mb-2 flex items-center gap-2">
                <img
                  src={toToken.logo}
                  alt={toToken.symbol}
                  className="h-7 w-7 rounded-full"
                />
                <div>
                  <span className="font-medium text-white">{toToken.symbol}</span>
                  <span className="ml-2 text-xs text-slate-400">on {toToken.chain}</span>
                </div>
              </div>

              <div className="min-h-[2rem] text-2xl font-semibold tracking-tight text-white">
                {estimatedAmount || '0.0'}
              </div>
              <div className="mt-1 text-xs text-slate-500">$0.00</div>
            </div>
          </div>
          
          {/* Fee and Time Estimate */}
          <div className="flex items-center justify-between px-1 text-xs text-slate-400">
            <div>Fee: $0.00</div>
            <div>~1 min</div>
          </div>

          {/* Exchange Rate Info */}
          <div className="surface-panel rounded-2xl p-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
                  <span>Exchange rate</span>
                  {priceSource && priceSource !== 'fallback' && (
                    <span
                      className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-emerald-300"
                      title={priceSource === 'cache' ? 'Served from 60s server-side cache' : 'Fresh from CoinGecko'}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      live
                    </span>
                  )}
                  {priceSource === 'fallback' && (
                    <span
                      className="text-[10px] uppercase tracking-wide text-indigo-200"
                      title="The relayer price feed is unreachable; this is a hardcoded estimate."
                    >
                      fallback
                    </span>
                  )}
                </div>
                {isLoadingRate ? (
                  <div className="flex items-center gap-1 text-xs text-cyan-200">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Updating...
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">
                    {rateLastUpdated && `Updated ${rateLastUpdated.toLocaleTimeString()}`}
                  </div>
                )}
              </div>
              <div className="text-xs text-white">
                1 ETH = {exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} XLM
                <span className="ml-1.5 text-slate-500">
                  · 1 XLM = {(1 / exchangeRate).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH
                </span>
              </div>
              {ethUsdPrice !== null && xlmUsdPrice !== null && (
                <div className="mt-1 text-[11px] text-slate-400">
                  ETH ${ethUsdPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="mx-1.5 text-slate-600">·</span>
                  XLM ${xlmUsdPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  <span className="mx-1.5 text-slate-600">·</span>
                  via relayer (CoinGecko, 15s SWR)
                </div>
              )}
              {priceSource === 'fallback' && (
                <div className="mt-1 text-[11px] text-indigo-200/80">
                  Live price feed unreachable. Final swap amount will use the relayer's price at execution time and may differ.
                </div>
              )}
          </div>
          
          {/* Status Message */}
          {statusMessage && (
            <div className="rounded-2xl border border-cyan-200/30 bg-cyan-200/[0.12] p-3 text-center">
              <div className="font-medium text-cyan-100">{statusMessage}</div>
            </div>
          )}

          {/* Network Mismatch Warning */}
          {mismatchLabel && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-400/35 bg-amber-500/12 p-3 text-left">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p className="text-sm text-amber-100/90">{mismatchLabel}</p>
            </div>
          )}

          {/* Disconnected Wallet Warning */}
          {!mismatchLabel && (!ethAddress || !stellarAddress) && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-amber-400/35 bg-amber-500/12 p-3 text-left">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <p className="text-sm text-amber-100/90">
                {!ethAddress && !stellarAddress
                  ? 'Connect both MetaMask and Freighter to bridge.'
                  : !ethAddress
                    ? 'Connect MetaMask to bridge.'
                    : 'Connect Freighter to bridge.'}
              </p>
            </div>
          )}
          
          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !amount || !walletsConnected || isBlocked}
            className={`button-hover-scale w-full rounded-full py-3.5 font-semibold transition-all ${
              walletsConnected && !isBlocked
                ? 'brand-cta'
                : 'cursor-not-allowed border border-white/5 bg-slate-700/45 text-slate-400'
            }`}
          >
            {!walletsConnected
              ? 'Connect Wallet'
              : isBlocked
                ? 'Network Mismatch'
                : isSubmitting
                  ? statusMessage || 'Processing...'
                  : 'Bridge'
            }
          </button>
        </form>
      )}
    </div>
  );
}
