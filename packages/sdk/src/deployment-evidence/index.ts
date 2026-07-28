/**
 * Canonical testnet deployment evidence for the OverSync cross-chain bridge.
 *
 * The data lives in `deployments.testnet.json` (loaded below via
 * `resolveJsonModule`) and is exposed through frozen, read-only records so
 * that downstream consumers (frontend, SCF evidence docs, investor data
 * room) cannot accidentally mutate the canonical metadata.
 *
 * The shape intentionally contains no secrets, no private RPC URLs, and no
 * signing material — only public chain + contract metadata suitable for
 * public reporting.
 */

import raw from "./deployments.testnet.json";

export type DeploymentStatus =
  | "testnet-live"
  | "mainnet-gated"
  | "mainnet-live"
  | "deprecated";

export type DeploymentChain = "Ethereum" | "Stellar";

/**
 * Frozen, immutable deployment evidence row. The helper functions below
 * always return deeply frozen instances — callers must not mutate them.
 */
export interface DeploymentEvidence {
  readonly chain: DeploymentChain;
  readonly network: string;
  readonly contractName: string;
  readonly address: string;
  readonly explorerUrl: string;
  readonly sourcePath: string;
  readonly status: DeploymentStatus;
  readonly deployedAt: string;
  readonly notes?: string;
}

interface RawEvidenceRow {
  chain: string;
  network: string;
  contractName: string;
  address: string;
  explorerUrl: string;
  sourcePath: string;
  status: string;
  deployedAt: string;
  notes?: string;
}

interface RawEvidenceFile {
  generatedAt: string;
  deployments: RawEvidenceRow[];
}

const KNOWN_CHAINS = new Set<DeploymentChain>(["Ethereum", "Stellar"]);
const KNOWN_STATUSES = new Set<DeploymentStatus>([
  "testnet-live",
  "mainnet-gated",
  "mainnet-live",
  "deprecated",
]);

const data: RawEvidenceFile = raw as RawEvidenceFile;

let cachedEvidence: ReadonlyArray<DeploymentEvidence> | null = null;

function assertValidRow(row: RawEvidenceRow, idx: number): void {
  if (!KNOWN_CHAINS.has(row.chain as DeploymentChain)) {
    throw new Error(
      `deployment-evidence: row #${idx} has unknown chain "${row.chain}"`
    );
  }
  if (!KNOWN_STATUSES.has(row.status as DeploymentStatus)) {
    throw new Error(
      `deployment-evidence: row #${idx} has unknown status "${row.status}"`
    );
  }
  if (row.chain === "Ethereum" && !/^0x[0-9a-fA-F]{40}$/.test(row.address)) {
    throw new Error(
      `deployment-evidence: row #${idx} (Ethereum) has malformed address "${row.address}"`
    );
  }
  if (row.chain === "Stellar" && !/^C[A-Z2-7]{55}$/.test(row.address)) {
    throw new Error(
      `deployment-evidence: row #${idx} (Stellar) has malformed address "${row.address}"`
    );
  }
  if (!row.explorerUrl.startsWith("https://")) {
    throw new Error(
      `deployment-evidence: row #${idx} explorerUrl must use https://`
    );
  }
  if (row.chain === "Ethereum" && !row.sourcePath.endsWith(".sol")) {
    throw new Error(
      `deployment-evidence: row #${idx} (Ethereum) sourcePath must end in .sol`
    );
  }
  if (row.chain === "Stellar" && !row.sourcePath.endsWith(".rs")) {
    throw new Error(
      `deployment-evidence: row #${idx} (Stellar) sourcePath must end in .rs`
    );
  }
  if (Number.isNaN(Date.parse(row.deployedAt))) {
    throw new Error(
      `deployment-evidence: row #${idx} deployedAt is not a valid ISO-8601 timestamp`
    );
  }
}

function buildEvidence(): ReadonlyArray<DeploymentEvidence> {
  data.deployments.forEach(assertValidRow);
  const rows = data.deployments.map((row) => Object.freeze({
    chain: row.chain as DeploymentChain,
    network: row.network,
    contractName: row.contractName,
    address: row.address,
    explorerUrl: row.explorerUrl,
    sourcePath: row.sourcePath,
    status: row.status as DeploymentStatus,
    deployedAt: row.deployedAt,
    ...(row.notes !== undefined ? { notes: row.notes } : {}),
  }) as DeploymentEvidence);
  return Object.freeze(rows);
}

/**
 * Return every canonical testnet deployment evidence record. The result is
 * memoized: subsequent calls return the same frozen reference.
 */
export function getDeploymentEvidence(): ReadonlyArray<DeploymentEvidence> {
  if (cachedEvidence === null) {
    cachedEvidence = buildEvidence();
  }
  return cachedEvidence;
}

/**
 * Find a single evidence record by chain + contract name. Both arguments
 * are matched case-insensitively. Returns `undefined` when no match exists.
 */
export function getEvidenceByContract(
  chain: string,
  contractName: string
): DeploymentEvidence | undefined {
  const wantedChain = chain.trim().toLowerCase();
  const wantedContract = contractName.trim().toLowerCase();
  return getDeploymentEvidence().find(
    (row) =>
      row.chain.toLowerCase() === wantedChain &&
      row.contractName.toLowerCase() === wantedContract
  );
}

/**
 * Return all deployment evidence records for a single chain. Chain name
 * is matched case-insensitively. The returned array is frozen.
 */
export function getEvidenceByChain(
  chain: string
): ReadonlyArray<DeploymentEvidence> {
  const wanted = chain.trim().toLowerCase();
  return Object.freeze(
    getDeploymentEvidence().filter(
      (row) => row.chain.toLowerCase() === wanted
    )
  );
}

/**
 * Return the ISO-8601 timestamp at which the included evidence bundle was
 * generated.
 */
export function getEvidenceGeneratedAt(): string {
  return data.generatedAt;
}
