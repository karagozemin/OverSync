import { CheckCircle2, AlertTriangle, XCircle, Shield } from 'lucide-react'
import { isMainnetEnabled, isTestnet, getCurrentNetwork, getContractAddresses } from '../config/networks'
import { resolveViteSepoliaRpcUrl, resolveViteMainnetRpcUrl } from '../config/rpc-urls'

type CheckStatus = 'pass' | 'warn' | 'fail'

interface CheckResult {
  label: string
  status: CheckStatus
  detail?: string
}

function hasPlaceholderValue(value: string | undefined, placeholderPatterns: RegExp[]): boolean {
  if (!value) return true
  return placeholderPatterns.some(pattern => pattern.test(value))
}

function checkResults(): CheckResult[] {
  const results: CheckResult[] = []
  const isDev = !import.meta.env.PROD
  const placeholderPatterns = [/YOUR_.*_HERE/i, /PLACEHOLDER/i, /^0x0{40}$/, /^G+A{55}$/, /^G{56}$/]

  // Coordinator URL configured
  const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL
  const hasCoordinatorUrl = Boolean(apiBaseUrl) || isDev
  results.push({
    label: 'Coordinator URL',
    status: hasCoordinatorUrl ? 'pass' : 'warn',
    detail: hasCoordinatorUrl ? 'Configured' : 'Using production URL fallback'
  })

  // Testnet mode flag
  const testnetFlag = (import.meta as any).env?.VITE_NETWORK
  const testnetMode = testnetFlag !== 'mainnet'
  results.push({
    label: 'Testnet mode',
    status: testnetMode ? 'pass' : 'warn',
    detail: testnetMode ? 'Active (default)' : 'Mainnet requested'
  })

  // Mainnet enabled flag
  const mainnetEnabled = isMainnetEnabled()
  results.push({
    label: 'Mainnet flag',
    status: mainnetEnabled ? 'pass' : 'warn',
    detail: mainnetEnabled ? 'Enabled' : 'Testnet-only mode'
  })

  // Contract addresses check
  const network = getCurrentNetwork()
  const contracts = getContractAddresses()
  const ethContracts = contracts.ethereum
  const hasPlaceholderContracts = hasPlaceholderValue(ethContracts.htlcBridge, placeholderPatterns) ||
    hasPlaceholderValue(ethContracts.escrowFactory, placeholderPatterns) ||
    hasPlaceholderValue(ethContracts.testToken, placeholderPatterns)
  results.push({
    label: 'Contract IDs',
    status: hasPlaceholderContracts ? 'warn' : 'pass',
    detail: isTestnet() ? 'Testnet contracts configured' : 'Mainnet contracts active'
  })

  // Explorer URLs
  const ethExplorer = network.ethereum.explorerUrl
  const stellarExplorer = network.stellar.explorerUrl
  const explorersOk = Boolean(ethExplorer && stellarExplorer)
  results.push({
    label: 'Explorer URLs',
    status: explorersOk ? 'pass' : 'fail',
    detail: explorersOk ? `${ethExplorer.split('/')[2] || 'Ethereum'}, ${stellarExplorer.split('/')[2] || 'Stellar'}` : 'Missing explorer configuration'
  })

  // RPC URLs
  const sepoliaRpc = resolveViteSepoliaRpcUrl()
  const mainnetRpc = resolveViteMainnetRpcUrl()
  const rpcOk = Boolean(sepoliaRpc && mainnetRpc)
  results.push({
    label: 'RPC endpoints',
    status: rpcOk ? 'pass' : 'warn',
    detail: rpcOk ? 'Configured (or fallbacks available)' : 'No RPC URLs configured'
  })

  // Placeholder check for production
  if (import.meta.env.PROD) {
    const hasPlaceholders = hasPlaceholderValue(apiBaseUrl, placeholderPatterns) ||
      hasPlaceholderValue(ethContracts.htlcBridge, placeholderPatterns) ||
      hasPlaceholderValue(ethContracts.escrowFactory, placeholderPatterns)
    results.push({
      label: 'Placeholder values',
      status: hasPlaceholders ? 'fail' : 'pass',
      detail: hasPlaceholders ? 'Found placeholder in production build' : 'No obvious placeholders'
    })
  }

  return results
}

export default function DeploymentSelfCheck() {
  const results = checkResults()
  const hasFail = results.some(r => r.status === 'fail')
  const hasWarn = results.some(r => r.status === 'warn')

  return (
    <div className="fixed bottom-20 right-4 z-[200] max-w-sm">
      <div className="rounded-xl border border-cyan-200/20 bg-[#070b1c]/95 p-4 shadow-2xl shadow-black/55 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan-100" />
          <span className="text-sm font-semibold text-white">Deployment Self-Check</span>
          {hasFail ? (
            <XCircle className="h-4 w-4 text-red-400" />
          ) : hasWarn ? (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          )}
        </div>
        <div className="space-y-2">
          {results.map(({ label, status, detail }) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
              <span className="text-xs text-slate-300">{label}</span>
              <div className="flex items-center gap-1.5">
                {detail && <span className="text-xs text-slate-400">{detail}</span>}
                {status === 'pass' && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                {status === 'warn' && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                {status === 'fail' && <XCircle className="h-3.5 w-3.5 text-red-400" />}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-center text-xs text-slate-500">
          Read-only check - no secrets exposed
        </div>
      </div>
    </div>
  )
}