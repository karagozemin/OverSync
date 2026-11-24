import { ExternalLink, BarChart3 } from 'lucide-react';
import { testnetTraction, type TractionMetric } from '../config/testnet-traction';
import { isTestnet } from '../config/networks';
import SafeExternalLink from './SafeExternalLink';

function TractionRow({ metric }: { metric: TractionMetric }) {
  const content = (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <span className="text-xs text-slate-300/80">{metric.label}</span>
      <span className={`text-xs font-semibold ${metric.status === 'measured' ? 'text-cyan-200' : metric.status === 'placeholder' ? 'text-amber-300/80' : 'text-slate-400'}`}>
        {metric.value}
      </span>
    </div>
  );

  if (metric.link) {
    return (
      <SafeExternalLink href={metric.link} className="block transition-opacity hover:opacity-80">
        {content}
      </SafeExternalLink>
    );
  }

  return content;
}

export default function TestnetTractionCard() {
  // Only render when the app is running in testnet mode AND the fixture is
  // tagged for testnet. A mismatch (e.g. mainnet mode, unknown network, or a
  // fixture tagged for a different network) hides the card entirely so testnet
  // counts can never appear on a mainnet screen.
  if (testnetTraction.network !== 'testnet' || !isTestnet()) {
    return null;
  }

  const { deployedContracts, supportedRoutes, testsByLayer, resolverCount, publicFrontendStatus, lastUpdated, sourceLinks } = testnetTraction;

  return (
    <div className="route-panel max-w-2xl">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/55">Testnet traction</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Public metrics</h2>
        </div>
        <BarChart3 className="h-5 w-5 text-indigo-200 drop-shadow-[0_0_12px_rgba(124,140,255,0.34)]" />
      </div>

      <div className="mt-4 space-y-2">
        <TractionRow metric={deployedContracts} />
        <TractionRow metric={supportedRoutes} />
        <TractionRow metric={testsByLayer} />
        <TractionRow metric={resolverCount} />
        <TractionRow metric={publicFrontendStatus} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 pt-3 text-xs text-slate-400">
        <span>Updated: {lastUpdated}</span>
        {sourceLinks.map((link) => (
          <SafeExternalLink
            key={link.url}
            href={link.url}
            className="inline-flex items-center gap-1 text-cyan-200/70 hover:text-cyan-200 transition-colors"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </SafeExternalLink>
        ))}
      </div>
    </div>
  );
}
