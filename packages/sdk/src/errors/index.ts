export enum OverSyncErrorCode {
  WALLET_REJECTED = "WALLET_REJECTED",
  RPC_FAILURE = "RPC_FAILURE",
  CONTRACT_REVERT = "CONTRACT_REVERT",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  UNSUPPORTED_NETWORK = "UNSUPPORTED_NETWORK",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export class OverSyncError extends Error {
  public code: OverSyncErrorCode;
  public originalError?: unknown;

  constructor(message: string, code: OverSyncErrorCode, originalError?: unknown) {
    super(message);
    this.name = "OverSyncError";
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Normalizes unknown errors into a structured OverSyncError, preserving the original cause.
 */
export function normalizeError(err: unknown): OverSyncError {
  if (err instanceof OverSyncError) return err;

  const msg = err instanceof Error ? err.message : String(err);

  // Basic heuristics for common errors
  if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("user denied")) {
    return new OverSyncError("Wallet rejected the transaction", OverSyncErrorCode.WALLET_REJECTED, err);
  }

  if (msg.toLowerCase().includes("revert") || msg.toLowerCase().includes("contract call failed")) {
    return new OverSyncError("Contract execution reverted", OverSyncErrorCode.CONTRACT_REVERT, err);
  }

  if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("rpc") || msg.toLowerCase().includes("simulation failed") || msg.toLowerCase().includes("submit failed")) {
    return new OverSyncError("RPC or network failure", OverSyncErrorCode.RPC_FAILURE, err);
  }

  return new OverSyncError(`Unknown error: ${msg}`, OverSyncErrorCode.UNKNOWN_ERROR, err);
}
