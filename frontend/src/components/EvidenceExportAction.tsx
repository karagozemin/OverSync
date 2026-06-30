import { FileDown } from 'lucide-react';
import { buildEvidenceData, downloadEvidenceJson } from '../lib/evidence';

export default function EvidenceExportAction() {
  const handleExport = () => {
    const data = buildEvidenceData();
    downloadEvidenceJson(data);
  };

  return (
    <div className="max-w-2xl">
      <button
        onClick={handleExport}
        className="button-hover-scale inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-white/[0.045] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-200/40 hover:bg-cyan-200/10 hover:text-white"
      >
        <FileDown className="h-4 w-4" />
        Export evidence JSON
      </button>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
        Download public proof points (contracts, coverage, mode) for reviewer follow-up. No secrets or wallet addresses.
      </p>
    </div>
  );
}
