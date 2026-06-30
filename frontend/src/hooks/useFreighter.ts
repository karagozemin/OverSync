import { useCallback, useEffect, useState } from 'react';
import freighterApi from '@stellar/freighter-api';

interface FreighterState {
  isConnected: boolean;
  address: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useFreighter() {
  const [state, setState] = useState<FreighterState>({
    isConnected: false,
    address: null,
    isLoading: false,
    error: null,
  });

  // Check if Freighter is connected on mount
  useEffect(() => {
    const checkConnection = async () => {
      console.log('🚀 Checking Freighter connection...');
      
      try {
        // Check if Freighter is available
        if (!freighterApi || typeof freighterApi.isConnected !== 'function') {
          console.log('❌ Freighter API not available');
          return;
        }
        
        const isConnected = await freighterApi.isConnected();
        console.log('🚀 Freighter connection status:', isConnected);
        
        if (isConnected) {
          const { address } = await freighterApi.getAddress();
          console.log('🚀 Freighter address:', address);
          
          setState(prev => ({
            ...prev,
            isConnected: true,
            address,
            error: null,
          }));
        }
      } catch (error) {
        console.error('❌ Error checking Freighter connection:', error);
        setState(prev => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Connection check failed',
        }));
      }
    };

    checkConnection();
  }, []);

  // Connect to Freighter
  const connect = useCallback(async () => {
    console.log('🚀 Connecting to Freighter...');
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      // Check if Freighter is available
      if (!freighterApi || typeof freighterApi.isConnected !== 'function') {
        throw new Error('Freighter wallet extension bulunamadı. Lütfen Freighter extension\'ı yükleyin.');
      }
      
      const isAvailable = await freighterApi.isConnected();
      console.log('🚀 Freighter availability:', isAvailable);
      
      if (!isAvailable) {
        throw new Error('Freighter wallet is not available. Please install Freighter extension.');
      }

      console.log('🚀 Requesting Freighter permission...');
      await freighterApi.setAllowed();
      
      console.log('🚀 Getting Freighter address...');
      const { address } = await freighterApi.getAddress();
      console.log('🚀 Freighter connected successfully:', address);
      
      setState(prev => ({
        ...prev,
        isConnected: true,
        address,
        isLoading: false,
        error: null,
      }));

      return address;
    } catch (error) {
      console.error('❌ Freighter connection error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect to Freighter';
      setState(prev => ({
        ...prev,
        isConnected: false,
        address: null,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, []);

  // Disconnect from Freighter
  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      address: null,
      isLoading: false,
      error: null,
    });
  }, []);

  // Get network info
  const getNetworkInfo = useCallback(async () => {
    try {
      const networkInfo = await freighterApi.getNetwork();
      return networkInfo;
    } catch (error) {
      console.error('Error getting network info:', error);
      return null;
    }
  }, []);

  // Check wallet readiness for demo flow
  const checkWalletReadiness = useCallback(async () => {
    const { checkHorizonHealth } = await import('../lib/checkHorizonHealth');
    const { STELLAR_NETWORKS } = await import('../config/networks');
    
    const networkName = window.location.search.includes('network=mainnet') ? 'mainnet' : 'testnet';
    const horizonUrl = STELLAR_NETWORKS[networkName].horizonUrl;
    
    const results = {
      freighterReachable: false,
      isConnected: false,
      accountPresent: false,
      testnetSelected: false,
      accountFunded: false,
      horizonReachable: false,
      errors: [] as string[],
    };

    try {
      // Check if Freighter is reachable
      if (!freighterApi || typeof freighterApi.isConnected !== 'function') {
        results.freighterReachable = false;
        results.errors.push('Freighter extension not available');
        return results;
      }

      results.freighterReachable = true;

      // Check if Freighter is connected
      const isConnected = await freighterApi.isConnected();
      results.isConnected = isConnected;
      if (!isConnected) {
        results.errors.push('Freighter wallet not connected');
      }

      // Get account details if connected
      if (isConnected) {
        results.accountPresent = true;
        try {
          const { address } = await freighterApi.getAddress();
          if (!address) {
            results.errors.push('No account address found');
          }
        } catch (error) {
          results.errors.push('Failed to get account address');
        }

        // Check network selection
        try {
          const networkInfo = await freighterApi.getNetwork();
          const networkPassphrase = networkInfo?.networkPassphrase || (typeof networkInfo === 'string' ? networkInfo : null);
          const isTestnet = networkPassphrase === 'Test SDF Network ; September 2015';
          results.testnetSelected = isTestnet;
          if (!isTestnet) {
            results.errors.push('Wrong network: Testnet not selected');
          }
        } catch (error) {
          results.errors.push('Failed to verify network selection');
        }

        // Check account balance using Horizon API
        try {
          const { address } = await freighterApi.getAddress();
          if (address) {
            const horizonResult = await checkHorizonHealth(horizonUrl);
            results.horizonReachable = horizonResult.reachable;
            
            if (horizonResult.reachable) {
              const accountResponse = await fetch(`${horizonUrl}/accounts/${address}`);
              if (accountResponse.ok) {
                const accountData = await accountResponse.json();
                const xlmBalance = accountData.balances.find((b: any) => b.asset_type === 'native')?.balance;
                results.accountFunded = !!xlmBalance && parseFloat(xlmBalance) > 0;
              } else if (accountResponse.status === 404) {
                results.accountFunded = false;
                results.errors.push('Account does not exist or is unfunded');
              }
            }
          }
        } catch (error) {
          results.errors.push('Failed to check account balance');
        }
      }

      // Always check Horizon health regardless of Freighter connection
      const horizonResult = await checkHorizonHealth(horizonUrl);
      results.horizonReachable = horizonResult.reachable;
      if (!horizonResult.reachable) {
        results.errors.push('Horizon RPC is not reachable');
      }
    } catch (error) {
      console.error('Error checking wallet readiness:', error);
      results.errors.push('Wallet readiness check failed');
    }

    return results;
  }, []);

  // Sign transaction
  const signTransaction = useCallback(async (
    xdr: string,
    networkPassphrase?: string,
    addressOverride?: string,
  ) => {
    const signerAddress = addressOverride ?? state.address;
    if (!signerAddress) {
      throw new Error('Wallet not connected');
    }

    try {
      const result = await freighterApi.signTransaction(xdr, {
        networkPassphrase,
        address: signerAddress,
      });
      return result.signedTxXdr;
    } catch (error) {
      console.error('Error signing transaction:', error);
      throw error;
    }
  }, [state.address]);

  return {
    ...state,
    connect,
    disconnect,
    getNetworkInfo,
    signTransaction,
  };
} 