import { useState } from 'react';
import type { NetworkModeState } from '../lib/useNetworkMode';
import {
  isMainnetEnabled,
  STELLAR_MAINNET_PASSPHRASE,
  STELLAR_TESTNET_PASSPHRASE,
} from '../config/networks';

import type { RecoveredOrder } from '../lib/orderRecovery';

interface Props {
  networkState: NetworkModeState;
  expectedNetwork?: 'testnet' | 'mainnet';
  order?: RecoveredOrder | null;
}

const MODE_LABEL: Record<'testnet' | 'mainnet', string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet',
};

const ETH_MODE_FROM_CHAIN: Record<string, string> = {
  '0x1': 'Ethereum Mainnet',
  '0xaa36a7': 'Sepolia Testnet',
};

const STELLAR_MODE_FROM_PASSPHRASE: Record<string, string> = {
  [STELLAR_MAINNET_PASSPHRASE]: 'Stellar Mainnet',
  [STELLAR_TESTNET_PASSPHRASE]: 'Stellar Testnet',
};

function describeMetamaskChain(chainId: string | null): string {
  if (!chainId) return 'unknown';
  const key = chainId.toLowerCase();
  return ETH_MODE_FROM_CHAIN[key] || `chain ${chainId}`;
}

function describeFreighterNetwork(passphrase: string | null): string {
  if (!passphrase) return 'unknown';
  return STELLAR_MODE_FROM_PASSPHRASE[passphrase] || passphrase;
}

export default function NetworkMismatchBanner({
  networkState,
  expectedNetwork,
  order,
}: Props) {
  const [busy, setBusy] = useState(false);
  const {
    mode,
    metamaskConnected,
    metamaskMatches,
    metamaskChainId,
    freighterConnected,
    freighterMatches,
    freighterNetworkPassphrase,
    hasAnyMismatch,
    setMode,
    syncWalletsToAppMode,
    refreshWalletNetworks,
  } = networkState;

  const targetMode: 'testnet' | 'mainnet' =
    expectedNetwork ?? order?.networkMode ?? mode;
  const isOrderNetworkMismatch = Boolean(
    (expectedNetwork && mode !== expectedNetwork) ||
    (order?.networkMode && mode !== order.networkMode)
  );

  if (!hasAnyMismatch && !isOrderNetworkMismatch) {
    return null;
  }

  const expectedLabel = MODE_LABEL[targetMode];
  const metamaskActual = describeMetamaskChain(metamaskChainId);
  const freighterActual = describeFreighterNetwork(freighterNetworkPassphrase);

  const walletWantsMainnet =
    (metamaskConnected &&
      !metamaskMatches &&
      metamaskChainId?.toLowerCase() === '0x1') ||
    (freighterConnected &&
      !freighterMatches &&
      freighterNetworkPassphrase === STELLAR_MAINNET_PASSPHRASE);

  const showSwitchAppToWallet = isMainnetEnabled() || !walletWantsMainnet;

  const onSwitchAppToWallet = async () => {
    setBusy(true);
    try {
      const nextMode: 'testnet' | 'mainnet' =
        metamaskConnected && !metamaskMatches
          ? metamaskChainId?.toLowerCase() === '0x1'
            ? 'mainnet'
            : 'testnet'
          : freighterConnected && !freighterMatches
            ? freighterNetworkPassphrase === STELLAR_MAINNET_PASSPHRASE
              ? 'mainnet'
              : 'testnet'
            : mode;
      if (nextMode !== mode) {
        await setMode(nextMode);
      } else {
        refreshWalletNetworks();
      }
    } finally {
      setBusy(false);
    }
  };

  const onSwitchWalletToApp = async () => {
    setBusy(true);
    try {
      await syncWalletsToAppMode();
      refreshWalletNetworks();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full bg-amber-500/15 border-y border-amber-400/40 text-amber-100 px-6 py-3 flex flex-col md:flex-row items-start md:items-center gap-3 justify-between">
      <div className="flex items-start gap-3 text-sm">
        <span className="mt-0.5">⚠</span>
        <div>
          <div className="font-semibold">
            {isOrderNetworkMismatch
              ? 'Your wallet network does not match the order network.'
              : 'Your wallet network does not match the app network.'}
          </div>
          <div className="text-amber-200/90">
            {isOrderNetworkMismatch ? (
              <span>Order was created for <b>{expectedLabel}</b>. </span>
            ) : (
              <span>App is set to <b>{expectedLabel}</b>. </span>
            )}
            {metamaskConnected && !metamaskMatches && (
              <span>
                Ethereum wallet is on <b>{metamaskActual}</b>
                {metamaskChainId ? ` (${metamaskChainId})` : ''}.{' '}
              </span>
            )}
            {freighterConnected && !freighterMatches && (
              <span>
                Freighter is on <b>{freighterActual}</b>.{' '}
              </span>
            )}
            {freighterConnected && !freighterMatches && (
              <span className="block mt-1 text-amber-200/75">
                Switch Freighter to <b>Stellar Testnet</b> in the extension if needed.
              </span>
            )}
            Balances and signing will fail until they match.
          </div>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onSwitchWalletToApp}
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-amber-400/20 hover:bg-amber-400/30 text-amber-50 text-xs font-semibold border border-amber-300/30 transition-colors disabled:opacity-50"
        >
          Switch wallet to {expectedLabel}
        </button>
        {showSwitchAppToWallet && (
          <button
            onClick={onSwitchAppToWallet}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-amber-50 text-xs font-medium border border-white/10 transition-colors disabled:opacity-50"
          >
            Switch app to wallet
          </button>
        )}
      </div>
    </div>
  );
}
