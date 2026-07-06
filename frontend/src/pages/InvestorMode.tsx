// src/pages/InvestorMode.tsx
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

export default function InvestorMode() {
  // Static data – could be moved to a config file if needed
  const contractAddresses = {
    ethereum: '0xb352339BEb146f2699d28D736700B953988bB178',
    stellar: 'CDIKSJKVMXKGBRD3BBEBMF7Q4GQJ52ECU6R6G5HEKXKXVGGWK2CTA6JK',
  };
  const explorerLinks = {
    ethereum: `https://sepolia.etherscan.io/address/${contractAddresses.ethereum}`,
    stellar: `https://stellar.expert/explorer/testnet/contract/${contractAddresses.stellar}`,
  };

  return (
    <div className="min-h-screen bg-[#050817] text-white p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-4xl font-bold">Investor Demo Mode</h1>
        <Link
          to="/"
          className="rounded-full bg-cyan-200/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-200/30"
        >
          Back to Swap UI
        </Link>
      </header>

      {/* Testnet Status */}
      <section className="mb-6 rounded-lg border border-indigo-300/30 bg-indigo-900/30 p-6">
        <h2 className="mb-2 text-2xl font-semibold">Testnet Status</h2>
        <p>This demo runs on the Sepolia/Ethereum testnet and Stellar testnet. Mainnet deployment is <strong>not yet live</strong>.</p>
      </section>

      {/* Smart Contract Information */}
      <section className="mb-6 rounded-lg border border-cyan-300/30 bg-cyan-900/30 p-6">
        <h2 className="mb-2 text-2xl font-semibold">Smart Contract Addresses</h2>
        <ul className="list-disc list-inside space-y-2 text-sm">
          <li>
            Ethereum: <code>{contractAddresses.ethereum}</code>{' '}
            <a
              href={explorerLinks.ethereum}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
            >
              View on Etherscan <ExternalLink className="h-3 w-3" />
            </a>
          </li>
          <li>
            Stellar: <code>{contractAddresses.stellar}</code>{' '}
            <a
              href={explorerLinks.stellar}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-300 hover:underline"
            >
              View on Stellar Explorer <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        </ul>
      </section>

      {/* Security Model */}
      <section className="mb-6 rounded-lg border border-green-300/30 bg-green-900/30 p-6">
        <h2 className="mb-2 text-2xl font-semibold">Non‑Custodial Security Model</h2>
        <p>
          OverSync uses an HTLC‑based atomic swap architecture. Funds never leave the user's wallet – they are locked on‑chain and released only when both sides fulfill the hash‑time‑locked conditions.
        </p>
      </section>

      {/* Refund Process */}
      <section className="mb-6 rounded-lg border border-yellow-300/30 bg-yellow-900/30 p-6">
        <h2 className="mb-2 text-2xl font-semibold">Refund Process</h2>
        <p>
          If a swap expires before the counter‑party claims the funds, the original sender can trigger a refund via the smart contract. The refund is automatic and returns the locked assets to the sender’s wallet.
        </p>
      </section>

      {/* Launch Status */}
      <section className="mb-6 rounded-lg border border-purple-300/30 bg-purple-900/30 p-6">
        <h2 className="mb-2 text-2xl font-semibold">Launch Status</h2>
        <p>
          Current stage: <strong>Testnet demo</strong>. Mainnet launch is gated by independent security audits of both HTLC contracts and the completion of the mainnet readiness checklist.
        </p>
      </section>
    </div>
  );
}
