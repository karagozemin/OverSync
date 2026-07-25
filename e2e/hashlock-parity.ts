/**
 * OverSync Cross-Chain Hashlock Parity Check
 *
 * Read-only script that demonstrates how the same secret/hashlock works
 * across Ethereum (EVM) and Stellar (Soroban) HTLC contracts.
 *
 * Usage:
 *   pnpm --filter @oversync/e2e check:parity
 *
 * Accept a specific preimage:
 *   PREIMAGE=0xdeadbeef... pnpm --filter @oversync/e2e check:parity
 *
 * The script does NOT connect to any RPC, sign transactions, or move funds.
 * It is a pure offline demonstration of hashlock material parity.
 */
import { generateSecret, hashSecret, verifyPreimage } from "../packages/sdk/src/secrets/index.js";

export interface ParityProof {
  preimage: `0x${string}`;
  sha256: `0x${string}`;
  keccak256: `0x${string}`;
  evmCrossChainRoute: boolean;
  evmNativeRoute: boolean;
  sorobanRoute: boolean;
  crossChainCompatible: boolean;
}

export function runParityCheck(preimage?: `0x${string}`): ParityProof {
  const secret = preimage ? hashSecret(preimage) : generateSecret();

  const evmCrossChain = verifyPreimage(secret.preimage, secret.sha256) === "sha256";
  const evmNative = verifyPreimage(secret.preimage, secret.keccak256) === "keccak256";
  const soroban = verifyPreimage(secret.preimage, secret.sha256) === "sha256";

  return {
    preimage: secret.preimage,
    sha256: secret.sha256,
    keccak256: secret.keccak256,
    evmCrossChainRoute: evmCrossChain,
    evmNativeRoute: evmNative,
    sorobanRoute: soroban,
    crossChainCompatible: evmCrossChain && soroban,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
const isMain =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === `file://${process.argv[1]}.ts`);

if (isMain) {
  const envPreimage = process.env.PREIMAGE as `0x${string}` | undefined;
  const proof = runParityCheck(envPreimage);

  process.stdout.write(`\n${"═".repeat(58)}\n`);
  process.stdout.write(`  OverSync Cross-Chain Hashlock Parity Check\n`);
  process.stdout.write(`  (read-only — no RPC, no wallet, no funds)\n`);
  process.stdout.write(`${"═".repeat(58)}\n\n`);

  process.stdout.write(`  Secret generated:  ${envPreimage ? "supplied by caller" : "fresh demo secret"}\n\n`);

  process.stdout.write(`  Preimage     ${proof.preimage}\n`);
  process.stdout.write(`  sha256       ${proof.sha256}\n`);
  process.stdout.write(`  keccak256    ${proof.keccak256}\n\n`);

  process.stdout.write(`  ${"─".repeat(58)}\n`);
  process.stdout.write(`  Route                              Status\n`);
  process.stdout.write(`  ${"─".repeat(58)}\n`);

  const ok = "✓ PASS";
  const fail = "✗ FAIL";

  process.stdout.write(
    `  EVM  — sha256  (cross-chain swap)   ${proof.evmCrossChainRoute ? ok : fail}\n`
  );
  process.stdout.write(
    `  EVM  — keccak256  (native EVM)      ${proof.evmNativeRoute ? ok : fail}\n`
  );
  process.stdout.write(
    `  Soroban — sha256                     ${proof.sorobanRoute ? ok : fail}\n`
  );

  process.stdout.write(`  ${"─".repeat(58)}\n`);

  if (proof.crossChainCompatible) {
    process.stdout.write(
      `  Cross-chain compatible             ${ok}\n`
    );
    process.stdout.write(
      `  Both chains accept sha256(preimage) as the shared hashlock.\n`
    );
  } else {
    process.stdout.write(
      `  Cross-chain compatible             ${fail}\n`
    );
    process.stdout.write(
      `  WARNING: hashlock material is NOT in sync across chains.\n`
    );
  }
  process.stdout.write(`\n`);
}
