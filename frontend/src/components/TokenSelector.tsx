import { useState, useEffect, useRef } from 'react';

// Token tipi
export interface Token {
  symbol: string;
  name: string;
  logo?: string;
  balance?: string;
  chain: 'ethereum' | 'stellar';
  address?: string;
  decimals: number;
}

interface TokenSelectorProps {
  selectedToken?: Token;
  onSelectToken: (token: Token) => void;
  chain?: 'ethereum' | 'stellar' | 'all';
  label?: string;
}

export default function TokenSelector({
  selectedToken,
  onSelectToken,
  chain = 'all',
  label = 'Select Token'
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Örnek token listesi
  useEffect(() => {
    // In real application, this data would come from API
    const mockTokens: Token[] = [
      {
        symbol: 'ETH',
        name: 'Ethereum',
        logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
        balance: '1.5',
        chain: 'ethereum',
        decimals: 18
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
        balance: '500',
        chain: 'ethereum',
        address: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
        decimals: 6
      },
      {
        symbol: 'WBTC',
        name: 'Wrapped Bitcoin',
        logo: 'https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.png',
        balance: '0.05',
        chain: 'ethereum',
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        decimals: 8
      },
      {
        symbol: 'XLM',
        name: 'Stellar Lumens',
        logo: 'https://cryptologos.cc/logos/stellar-xlm-logo.png',
        balance: '1000',
        chain: 'stellar',
        decimals: 7
      },
      {
        symbol: 'yXLM',
        name: 'Yield XLM',
        logo: 'https://cryptologos.cc/logos/stellar-xlm-logo.png',
        balance: '500',
        chain: 'stellar',
        address: 'yXLM-GDLQY5ZKDPZWVHWCFSYCBWFPXQTDLJDKTRAOWJGZGQW5KGZFJ3IJIPT',
        decimals: 7
      },
      {
        symbol: 'USDC',
        name: 'USD Coin',
        logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
        balance: '250',
        chain: 'stellar',
        address: 'USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        decimals: 6
      }
    ];

    // Chain filtresi
    if (chain !== 'all') {
      const filteredTokens = mockTokens.filter(token => token.chain === chain);
      setTokens(filteredTokens);
    } else {
      setTokens(mockTokens);
    }
  }, [chain]);

  // Dropdown dışına tıklandığında kapanma
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filtrelenmiş tokenlar
  const filteredTokens = tokens.filter(token => {
    const query = searchQuery.toLowerCase();
    return (
      token.symbol.toLowerCase().includes(query) ||
      token.name.toLowerCase().includes(query) ||
      token.address?.toLowerCase().includes(query)
    );
  });

  // Token seçme
  const handleSelectToken = (token: Token) => {
    onSelectToken(token);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-300 mb-1">
        {label}
      </label>
      
      {/* Token Seçici Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-cyan-200/[0.18] bg-white/[0.055] px-4 py-3 text-white transition-colors hover:border-cyan-200/35 hover:bg-cyan-200/10"
      >
        {selectedToken ? (
          <div className="flex items-center">
            {selectedToken.logo && (
              <img 
                src={selectedToken.logo} 
                alt={selectedToken.symbol} 
                className="w-6 h-6 mr-2 rounded-full"
              />
            )}
            <span>{selectedToken.symbol}</span>
            {selectedToken.balance && (
              <span className="ml-2 text-sm text-gray-400">
                ({selectedToken.balance})
              </span>
            )}
          </div>
        ) : (
          <span className="text-gray-400">Select a token</span>
        )}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      
      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-cyan-200/20 bg-[#070b1c]/95 shadow-2xl backdrop-blur-xl">
          {/* Search */}
          <div className="p-3 border-b border-white/10">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search token name or address"
              className="w-full rounded-lg border border-cyan-200/[0.18] bg-white/[0.055] px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-200/40"
              autoFocus
            />
          </div>
          
          {/* Token List */}
          <div className="max-h-60 overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="p-4 text-center text-gray-400">
                No tokens found
              </div>
            ) : (
              filteredTokens.map((token) => (
                <button
                  key={`${token.chain}-${token.symbol}`}
                  type="button"
                  onClick={() => handleSelectToken(token)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                >
                  <div className="flex items-center">
                    {token.logo && (
                      <img 
                        src={token.logo} 
                        alt={token.symbol} 
                        className="w-8 h-8 mr-3 rounded-full"
                      />
                    )}
                    <div className="text-left">
                      <div className="font-medium text-white">{token.symbol}</div>
                      <div className="text-xs text-gray-400">{token.name}</div>
                    </div>
                  </div>
                  
                  {token.balance && (
                    <div className="text-right">
                      <div className="text-sm text-white">{token.balance}</div>
                      <div className="text-xs text-gray-400">
                        {token.chain === 'ethereum' ? 'Ethereum' : 'Stellar'}
                      </div>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
} 
