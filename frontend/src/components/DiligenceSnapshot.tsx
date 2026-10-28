import { isMainnetEnabled, ETHEREUM_NETWORKS } from '../config/networks';
import { getDeploymentRecord, diffDeploymentRecords, type DeploymentRecord } from '../config/deployment';
import { getSelfCheckDeploymentRecord } from './DeploymentSelfCheck';
import { AlertTriangle, ExternalLink, ShieldAlert } from 'lucide-react';
import CopyableIdentifier from './CopyableIdentifier';

export interface DiligenceSnapshotProps {
  /** Record the snapshot renders. Defaults to the shared deployment module. */
  record?: DeploymentRecord;
  /** Record the Deployment Self-Check reports. Any disagreement hides the snapshot. */
  selfCheckRecord?: DeploymentRecord;
}

export default function DiligenceSnapshot({
  record = getDeploymentRecord(),
  selfCheckRecord = getSelfCheckDeploymentRecord(),
}: DiligenceSnapshotProps = {}) {
  const currentPublicMode = isMainnetEnabled() ? 'Mainnet-enabled' : 'Testnet-only';
  const mismatches = diffDeploymentRecords(record, selfCheckRecord);

  const isTestnetRecord = record.network !== 'mainnet';
  const ethLabel = isTestnetRecord ? 'Sepolia' : 'Ethereum';
  const stellarLabel = isTestnetRecord ? 'Stellar Testnet' : 'Stellar';
  const ethExplorerBase = isTestnetRecord
    ? ETHEREUM_NETWORKS.sepolia?.explorerUrl || 'https://sepolia.etherscan.io'
    : ETHEREUM_NETWORKS.mainnet?.explorerUrl || 'https://etherscan.io';
  const stellarExplorerBase = `https://stellar.expert/explorer/${isTestnetRecord ? 'testnet' : 'public'}/contract`;

  // Coordinator status url
  const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  const isProd = (import.meta as any).env?.PROD;

  const isCoordinatorConfigured = !!(apiBaseUrl || isProd);
  const coordinatorStatusUrl = apiBaseUrl
    ? `${apiBaseUrl.replace(/\/+$/, '')}/health`
    : 'https://oversync-k36vx.ondigitalocean.app/health';

  const renderValueOrFallback = (
    value: string | null,
    buildLink?: (val: string) => string,
    copyLabel: string = 'address',
    fallback: string = 'Not configured'
  ) => {
    if (!value) {
      return <span className="text-slate-400 font-medium">{fallback}</span>;
    }
    if (buildLink) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <a
            href={buildLink(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 font-mono text-xs transition-colors"
          >
            <span className="truncate max-w-[180px] sm:max-w-xs">{value}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <CopyableIdentifier
            value={value}
            hideDisplay
            copyLabel={copyLabel}
          />
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs text-white">{value}</span>
        <CopyableIdentifier
          value={value}
          hideDisplay
          copyLabel={copyLabel}
        />
      </span>
    );
  };

  const header = (
    <div className="flex items-center justify-between border-b border-white/10 pb-3">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/55">Security Auditing</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Diligence Snapshot</h2>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-200/10 text-cyan-300">
        <ShieldAlert className="h-4.5 w-4.5" />
      </div>
    </div>
  );

  if (mismatches.length > 0) {
    // Never show addresses a reviewer might trust when the self-check
    // reports a different deployment.
    return (
      <div className="route-panel max-w-2xl space-y-4" data-testid="diligence-snapshot-panel">
        {header}
        <div
          role="alert"
          data-testid="diligence-snapshot-mismatch"
          className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Snapshot hidden: deployment record disagrees with the self-check.</p>
            <p className="mt-1 text-xs">
              Disagreeing field{mismatches.length > 1 ? 's' : ''}:{' '}
              {mismatches.map((field, i) => (
                <span key={field}>
                  {i > 0 && ', '}
                  <code className="font-mono">{field}</code>
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const rows: { label: string; node: JSX.Element }[] = [
    {
      label: `${ethLabel} HTLC contract`,
      node: renderValueOrFallback(record.ethereum.escrow, (addr) => `${ethExplorerBase}/address/${addr}`, `${ethLabel} HTLC contract address`),
    },
    {
      label: `${ethLabel} ResolverRegistry`,
      node: renderValueOrFallback(record.ethereum.registry, (addr) => `${ethExplorerBase}/address/${addr}`, `${ethLabel} ResolverRegistry address`),
    },
    {
      label: `${stellarLabel} HTLC contract`,
      node: renderValueOrFallback(record.stellar.escrow, (id) => `${stellarExplorerBase}/${id}`, `${stellarLabel} HTLC contract ID`),
    },
    {
      label: `${stellarLabel} ResolverRegistry`,
      node: renderValueOrFallback(record.stellar.registry, (id) => `${stellarExplorerBase}/${id}`, `${stellarLabel} ResolverRegistry contract ID`),
    },
    {
      label: `${ethLabel} HTLC bytecode hash`,
      node: renderValueOrFallback(record.ethereum.escrowCodeHash, undefined, 'bytecode hash', 'Not recorded'),
    },
    {
      label: `${ethLabel} ResolverRegistry bytecode hash`,
      node: renderValueOrFallback(record.ethereum.registryCodeHash, undefined, 'bytecode hash', 'Not recorded'),
    },
    {
      label: `${stellarLabel} HTLC wasm hash`,
      node: renderValueOrFallback(record.stellar.escrowCodeHash, undefined, 'wasm hash', 'Not recorded'),
    },
    {
      label: `${stellarLabel} ResolverRegistry wasm hash`,
      node: renderValueOrFallback(record.stellar.registryCodeHash, undefined, 'wasm hash', 'Not recorded'),
    },
  ];

  return (
    <div className="route-panel max-w-2xl space-y-4" data-testid="diligence-snapshot-panel">
      {header}

      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center py-1 border-b border-white/5">
          <span className="text-slate-300">Current public mode</span>
          <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {currentPublicMode}
          </span>
        </div>

        <div className="flex justify-between items-center py-1 border-b border-white/5">
          <span className="text-slate-300 font-medium">Deployment network</span>
          <span className="font-mono text-xs text-white" data-testid="diligence-snapshot-network">
            {record.network ?? 'Not configured'}
          </span>
        </div>

        {rows.map(({ label, node }) => (
          <div key={label} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-1 border-b border-white/5 gap-1">
            <span className="text-slate-300 font-medium">{label}</span>
            {node}
          </div>
        ))}

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
