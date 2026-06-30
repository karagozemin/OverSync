export interface CapabilityRoute {
  direction: 'eth_to_xlm' | 'xlm_to_eth';
  fromChain: 'ethereum' | 'stellar';
  toChain: 'ethereum' | 'stellar';
  supportedAssets: {
    fromAsset: string;
    toAsset: string;
    testnetAddressOrCode: string;
  }[];
  mainnetStatus: 'gated_until_audit' | 'live_production_v1' | 'not_supported';
  mainnetCaveatText: string;
  requiredContractsAndServices: string[];
}

export interface CapabilityMatrix {
  supportedChains: ('ethereum' | 'stellar')[];
  routes: CapabilityRoute[];
  caveatsForUnsupportedRoutes: Record<string, string>;
}

export function getCapabilityMatrix(): CapabilityMatrix {
  return {
    supportedChains: ['ethereum', 'stellar'],
    routes: [
      {
        direction: 'eth_to_xlm',
        fromChain: 'ethereum',
        toChain: 'stellar',
        supportedAssets: [
          {
            fromAsset: 'ETH',
            toAsset: 'XLM',
            testnetAddressOrCode: '0x0000000000000000000000000000000000000000'
          },
          {
            fromAsset: 'USDC (ERC-20)',
            toAsset: 'USDC (Stellar)',
            testnetAddressOrCode: '0xa0b86a33e6417c4fd30ad9d05d6b9b7cd6dd11b'
          }
        ],
        mainnetStatus: 'gated_until_audit',
        mainnetCaveatText: 'v2 decentralized HTLC bridge is currently gated on mainnet pending final security audit. Only v1 legacy single-relayer is active on mainnet.',
        requiredContractsAndServices: [
          'Ethereum HTLCEscrow Contract',
          'Soroban HTLC Contract',
          'OverSync Coordinator Service',
          'Resolver Node Network'
        ]
      },
      {
        direction: 'xlm_to_eth',
        fromChain: 'stellar',
        toChain: 'ethereum',
        supportedAssets: [
          {
            fromAsset: 'XLM',
            toAsset: 'ETH',
            testnetAddressOrCode: 'XLM'
          },
          {
            fromAsset: 'USDC (Stellar)',
            toAsset: 'USDC (ERC-20)',
            testnetAddressOrCode: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
          }
        ],
        mainnetStatus: 'gated_until_audit',
        mainnetCaveatText: 'v2 decentralized HTLC bridge is currently gated on mainnet pending final security audit. Only v1 legacy single-relayer is active on mainnet.',
        requiredContractsAndServices: [
          'Soroban HTLC Contract',
          'Ethereum HTLCEscrow Contract',
          'OverSync Coordinator Service',
          'Resolver Node Network'
        ]
      }
    ],
    caveatsForUnsupportedRoutes: {
      'solana': 'Solana integration is on the roadmap for Q4 2027.',
      'bitcoin': 'Native Bitcoin is not supported. Use wrapped assets on Ethereum instead.'
    }
  };
}
