import DeploymentSelfCheck from './DeploymentSelfCheck'

export default function LaunchReadinessSurface() {
  return (
    <div className="min-h-screen bg-[#050817] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <DeploymentSelfCheck />
      </div>
    </div>
  )
}