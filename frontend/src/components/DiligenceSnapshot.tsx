import React from 'react';
import { useDeploymentContext } from '../context/DeploymentContext';
import { NetworkConfig } from '../config/networks';

interface DiligenceSnapshotProps {
  selfCheckRecord: {
    registryAddress: string;
    escrowAddress: string;
    networkId: string;
    bytecodeHashes: Record<string, string>;
  };
}

export const DiligenceSnapshot: React.FC<DiligenceSnapshotProps> = ({ selfCheckRecord }) => {
  const { deploymentRecord } = useDeploymentContext();

  if (!deploymentRecord) {
    return <div className="dil-snapshot">No deployment record available</div>;
  }

  const isMatchingRecord = (
    deploymentRecord.registryAddress.toLowerCase() === selfCheckRecord.registryAddress.toLowerCase() &&
    deploymentRecord.escrowAddress.toLowerCase() === selfCheckRecord.escrowAddress.toLowerCase() &&
    deploymentRecord.networkId === selfCheckRecord.networkId
  );

  const hasBytecodeMismatch = Object.entries(selfCheckRecord.bytecodeHashes).some(
    ([contractName, hash]) => deploymentRecord.bytecodeHashes?.[contractName]?.toLowerCase() !== hash.toLowerCase()
  );

  const shouldHideSnapshot = !isMatchingRecord || hasBytecodeMismatch;

  if (shouldHideSnapshot) {
    const differingFields: string[] = [];
    if (deploymentRecord.registryAddress.toLowerCase() !== selfCheckRecord.registryAddress.toLowerCase()) {
      differingFields.push(`registry: expected ${selfCheckRecord.registryAddress}, got ${deploymentRecord.registryAddress}`);
    }
    if (deploymentRecord.escrowAddress.toLowerCase() !== selfCheckRecord.escrowAddress.toLowerCase()) {
      differingFields.push(`escrow: expected ${selfCheckRecord.escrowAddress}, got ${deploymentRecord.escrowAddress}`);
    }
    if (deploymentRecord.networkId !== selfCheckRecord.networkId) {
      differingFields.push(`network: expected ${selfCheckRecord.networkId}, got ${deploymentRecord.networkId}`);
    }
    if (hasBytecodeMismatch) {
      differingFields.push('bytecode hashes do not match');
    }

    return (
      <div className="dil-snapshot dil-snapshot--hidden" data-testid="dil-snapshot-hidden">
        <div className="dil-snapshot__warning">Snapshot hidden due to mismatched deployment record</div>
        <div className="dil-snapshot__differences">
          {differingFields.map((field, i) => (
            <div key={i}>{field}</div>
          ))}
        </div>
      </div>
    );
  }

  const networkConfig = NetworkConfig[deploymentRecord.networkId];

  return (
    <div className="dil-snapshot" data-testid="dil-snapshot-visible">
      <h3>Diligence Snapshot</h3>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Network:</span>
        <span className="dil-snapshot__value">{networkConfig?.name || deploymentRecord.networkId}</span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Registry:</span>
        <span className="dil-snapshot__value">{deploymentRecord.registryAddress}</span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Escrow:</span>
        <span className="dil-snapshot__value">{deploymentRecord.escrowAddress}</span>
      </div>
      <div className="dil-snapshot__field">
        <span className="dil-snapshot__label">Bytecode Hashes:</span>
        <div className="dil-snapshot__hashes">
          {Object.entries(deploymentRecord.bytecodeHashes || {}).map(([contractName, hash]) => (
            <div key={contractName}>
              {contractName}: {hash.slice(0, 6)}...{hash.slice(-4)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
