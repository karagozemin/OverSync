import { isMainnetEnabled, ETHEREUM_NETWORKS } from '../config/networks';
import deployments from '../../../deployments.testnet.json';
import { ExternalLink, ShieldAlert } from 'lucide-react';

export default function DiligenceSnapshot() {
  const currentPublicMode = isMainnetEnabled() ? 'Mainnet-enabled' : 'Testnet-only';

  // Read values safely from deployments.testnet.json
  const ethHtlc = deployments?.ethereum?.contracts?.HTLCEscrow || null;
  const ethRegistry = deployments?.ethereum?.contracts?.ResolverRegistry || null;
  const stellarHtlc = deployments?.stellar?.contracts?.HTLC || null;
  const stellarRegistry = deployments?.stellar?.contracts?.ResolverRegistry || null;

  // Coordinator status url
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

  const isCoordinatorConfigured = !!apiBaseUrl;
  const coordinatorStatusUrl = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/+$/, '')}/health`
    : '';

  const sepoliaExplorerBase = ETHEREUM_NETWORKS.sepolia?.explorerUrl || 'https://sepolia.etherscan.io';

  const renderValueOrFallback = (
    value: string | null,
    buildLink?: (val: string) => string
  ) => {
    if (!value) {
      return <span className="text-slate-400 font-medium">Not configured</span>;
    }
    if (buildLink) {
      return (
        <a
          href={buildLink(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs transition-colors"
        >
          <span className="truncate max-w-[180px] sm:max-w-xs">{value}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
    }
    return <span className="font-mono text-xs text-white">{value}</span>;
  };

  return (
    <div className="route-panel max-w-2xl space-y-4" data-testid="diligence-snapshot-panel">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/55">Security Auditing</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Diligence Snapshot</h2>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-200/10 text-cyan-300">
          <ShieldAlert className="h-4.5 w-4.5" />
        </div>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center py-1 border-b border-white/5">
          <span className="text-slate-300">Current public mode</span>
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {currentPublicMode}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1 border-b border-white/5 gap-1">
          <span className="text-slate-300 font-medium">Sepolia HTLC contract</span>
          {renderValueOrFallback(ethHtlc, (addr) => `${sepoliaExplorerBase}/address/${addr}`)}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1 border-b border-white/5 gap-1">
          <span className="text-slate-300 font-medium">Sepolia ResolverRegistry</span>
          {renderValueOrFallback(ethRegistry, (addr) => `${sepoliaExplorerBase}/address/${addr}`)}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1 border-b border-white/5 gap-1">
          <span className="text-slate-300 font-medium">Stellar Testnet HTLC contract</span>
          {renderValueOrFallback(stellarHtlc, (id) => `https://stellar.expert/explorer/testnet/contract/${id}`)}
        </div>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1 border-b border-white/5 gap-1">
          <span className="text-slate-300 font-medium">Stellar Testnet ResolverRegistry</span>
          {renderValueOrFallback(stellarRegistry, (id) => `https://stellar.expert/explorer/testnet/contract/${id}`)}
        </div>

        <div className="flex justify-between items-center py-1 border-b border-white/5">
          <span className="text-slate-300 font-medium">Coordinator status link</span>
          {isCoordinatorConfigured ? (
            <a
              href={coordinatorStatusUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-xs transition-colors"
            >
              Check Health
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <span className="text-slate-400 font-medium">Not configured</span>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-slate-950/40 border border-white/5 p-3 text-xs text-slate-400 leading-relaxed italic text-center">
        "No validator set, no attester, HTLC refund path."
      </div>
    </div>
  );
}
