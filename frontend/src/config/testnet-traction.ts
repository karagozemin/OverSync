export interface TractionMetric {
  label: string;
  value: string;
  status: 'measured' | 'placeholder' | 'not-yet';
  link?: string;
}

export interface TestnetTractionData {
  deployedContracts: TractionMetric;
  supportedRoutes: TractionMetric;
  testsByLayer: TractionMetric;
  resolverCount: TractionMetric;
  publicFrontendStatus: TractionMetric;
  lastUpdated: string;
  sourceLinks: { label: string; url: string }[];
}

export const testnetTraction: TestnetTractionData = {
  deployedContracts: {
    label: 'Deployed contracts',
    value: '2',
    status: 'measured',
    link: 'https://sepolia.etherscan.io/address/0x3f344ACDd17a0c4D21096da895152820f595dc8A',
  },
  supportedRoutes: {
    label: 'Supported testnet routes',
    value: 'ETH / XLM',
    status: 'measured',
  },
  testsByLayer: {
    label: 'Tests by layer',
    value: 'TODO — not yet measured',
    status: 'not-yet',
  },
  resolverCount: {
    label: 'Resolver count',
    value: 'not yet public',
    status: 'not-yet',
  },
  publicFrontendStatus: {
    label: 'Public frontend',
    value: 'Live at oversync.xyz',
    status: 'measured',
    link: 'https://oversync.xyz',
  },
  lastUpdated: '2026-06-30',
  sourceLinks: [
    {
      label: 'Ethereum Sepolia explorer',
      url: 'https://sepolia.etherscan.io',
    },
    {
      label: 'Stellar testnet explorer',
      url: 'https://testnet.stellarchain.io',
    },
    {
      label: 'Contract source (repo)',
      url: 'https://github.com/karagozemin/OverSync/tree/main/contracts',
    },
  ],
};
