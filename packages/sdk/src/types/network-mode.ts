export type AppNetworkMode = 'testnet' | 'mainnet';

export interface NetworkModeGuard {
  mode: AppNetworkMode;
  isMainnetEnabled: boolean;
  status: 'testnet' | 'mainnet_gated' | 'mainnet_enabled';
  reason: string;
  disableUiActions: boolean;
}

export function checkNetworkMode(
  mode: AppNetworkMode,
  isMainnetEnabledFlag: boolean
): NetworkModeGuard {
  if (mode === 'mainnet') {
    if (!isMainnetEnabledFlag) {
      return {
        mode: 'mainnet',
        isMainnetEnabled: false,
        status: 'mainnet_gated',
        reason: 'Mainnet operations are currently gated pending final security audits.',
        disableUiActions: true
      };
    }
    return {
      mode: 'mainnet',
      isMainnetEnabled: true,
      status: 'mainnet_enabled',
      reason: 'Mainnet operations are fully enabled.',
      disableUiActions: false
    };
  }

  return {
    mode: 'testnet',
    isMainnetEnabled: isMainnetEnabledFlag,
    status: 'testnet',
    reason: 'Testnet mode is active. Only Sepolia and Stellar Testnet operations are supported.',
    disableUiActions: false
  };
}
