import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Wallet, Network, Loader2, RefreshCw } from 'lucide-react';
import { useFreighter } from '../hooks/useFreighter';
import './StellarWalletPreflight.css';

interface WalletReadinessResult {
  freighterReachable: boolean;
  isConnected: boolean;
  accountPresent: boolean;
  testnetSelected: boolean;
  accountFunded: boolean;
  horizonReachable: boolean;
  errors: string[];
}

interface StellarWalletPreflightProps {
  isVisible: boolean;
  onReady?: (isReady: boolean) => void;
}

export default function StellarWalletPreflight({ isVisible, onReady }: StellarWalletPreflightProps) {
  const [readiness, setReadiness] = useState<WalletReadinessResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const freighter = useFreighter();
  const [isVisiblePanel, setIsVisiblePanel] = useState(isVisible);

  const getNextStepMessage = () => {
    if (!readiness) return '';

    if (!readiness.freighterReachable) {
      return 'Install Freighter from https://freighter.app/';
    }
    if (!readiness.isConnected) {
      return 'Click "Connect Wallet" in Freighter and select your account';
    }
    if (!readiness.accountPresent) {
      return 'Ensure an account is selected in Freighter';
    }
    if (!readiness.testnetSelected) {
      return 'Switch to Stellar Testnet in Freighter settings';
    }
    if (!readiness.accountFunded) {
      return 'Visit https://laboratory.stellar.org/#account-creator to fund your testnet account';
    }
    if (!readiness.horizonReachable) {
      return 'Horizon RPC is not reachable - check network connectivity';
    }
    return 'Wallet is ready for demo flow';
  };

  const getProgressPercentage = () => {
    if (!readiness) return 0;
    const checks = [
      readiness.freighterReachable,
      readiness.isConnected,
      readiness.accountPresent,
      readiness.testnetSelected,
      readiness.accountFunded,
      readiness.horizonReachable,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  };

  const isWalletReady = (result: WalletReadinessResult): boolean => {
    return result.freighterReachable &&
           result.isConnected &&
           result.accountPresent &&
           result.testnetSelected &&
           result.accountFunded &&
           result.horizonReachable;
  };

  const formatError = (error: string): string => {
    const errorPatterns: Record<string, string> = {
      'Freighter extension not available': 'Install Freighter wallet extension',
      'Freighter wallet not connected': 'Connect your Freighter wallet',
      'No account address found': 'Select an account in Freighter',
      'Wrong network: Testnet not selected': 'Switch to Stellar Testnet in Freighter',
      'Failed to verify network selection': 'Check Freighter network settings',
      'Failed to get account address': 'Refresh Freighter connection',
      'Wallet readiness check failed': 'Try refreshing the wallet check',
    };

    for (const [pattern, message] of Object.entries(errorPatterns)) {
      if (error.includes(pattern)) {
        return message;
      }
    }

    return error;
  };

  const checkReadiness = async () => {
    setIsLoading(true);
    try {
      const result = await freighter.checkWalletReadiness();
      setReadiness(result);

      if (onReady) {
        const isReady = isWalletReady(result);
        onReady(isReady);
      }
      setRetryCount(prev => prev + 1);
    } catch (error) {
      console.error('Error checking wallet readiness:', error);
      setReadiness({
        freighterReachable: false,
        isConnected: false,
        accountPresent: false,
        testnetSelected: false,
        accountFunded: false,
        horizonReachable: false,
        errors: ['Failed to check wallet readiness'],
      });
      if (onReady) onReady(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible !== isVisiblePanel) {
      setIsVisiblePanel(isVisible);
    }
  }, [isVisible]);

  useEffect(() => {
    if (isVisible) {
      checkReadiness();
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const checks = [
    { key: 'freighterReachable' as const, label: 'Freighter reachable', icon: CheckCircle },
    { key: 'isConnected' as const, label: 'Wallet connected', icon: Wallet },
    { key: 'accountPresent' as const, label: 'Account present', icon: CheckCircle },
    { key: 'testnetSelected' as const, label: 'Testnet selected', icon: Network },
    { key: 'accountFunded' as const, label: 'Account funded', icon: CheckCircle },
  ];

  return (
    <div className="wallet-preflight-overlay">
      <div className="wallet-preflight-container">
        <div className="wallet-preflight-header">
          <div className="wallet-preflight-icon">
            <Wallet className="h-6 w-6" />
          </div>
          <h2 className="wallet-preflight-title">Stellar Wallet Readiness Check</h2>
          <div className="wallet-preflight-progress">
            <div
              className="wallet-preflight-progress-fill"
              style={{ width: `${getProgressPercentage()}%` }}
            />
            <span className="wallet-preflight-progress-text">
              {isLoading ? 'Checking...' : `${getProgressPercentage()}% Complete`}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="wallet-preflight-loading">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p>Checking wallet readiness...</p>
          </div>
        ) : readiness ? (
          <div className="wallet-preflight-content">
            <div className="wallet-preflight-results">
              {checks.map((check) => {
                const isOk = readiness[check.key];
                const Icon = isOk ? check.icon : AlertTriangle;
                const colorClass = isOk ? 'text-green-400' : 'text-amber-400';

                return (
                  <div key={check.key} className="wallet-preflight-result-item">
                    <div className={`wallet-preflight-status-icon ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="wallet-preflight-status-text">{check.label}</span>
                  </div>
                );
              })}
            </div>

            {readiness.errors.length > 0 && (
              <div className="wallet-preflight-errors">
                <h3 className="wallet-preflight-errors-title">Issues to fix:</h3>
                <ul className="wallet-preflight-errors-list">
                  {readiness.errors.map((error, index) => (
                    <li key={index} className="wallet-preflight-error-item">
                      • {formatError(error)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="wallet-preflight-next-step">
              <p className="wallet-preflight-next-step-label">Next step:</p>
              <p className="wallet-preflight-next-step-text">{getNextStepMessage()}</p>
            </div>

            <div className="wallet-preflight-retry-section">
              <button
                onClick={checkReadiness}
                disabled={isLoading}
                className="wallet-preflight-retry-button"
              >
                <RefreshCw className="h-4 w-4" />
                Retry Check
              </button>
              {retryCount > 0 && (
                <span className="wallet-preflight-retry-count">
                  (Retried {retryCount} times)
                </span>
              )}
            </div>
          </div>
        ) : null}

        {readiness && !isLoading && (
          <div className="wallet-preflight-footer">
            <div className={`wallet-preflight-status-badge ${isWalletReady(readiness) ? 'ready' : 'pending'}`}>
              {isWalletReady(readiness) ? '✅ Wallet Ready' : '⚠️ Wallet Not Ready'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
