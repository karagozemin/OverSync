#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { registerCommand, statusCommand, unregisterCommand } from "./commands/register.js";
import { readinessCommand } from "./commands/readiness.js";

const program = new Command();

program
  .name("oversync-resolver")
  .description("Reference resolver runner for the OverSync cross-chain bridge")
  .version("0.1.0");

program
  .command("run")
  .description("Start the resolver. Listens to both chains and reacts to HTLC events.")
  .action(async () => {
    await runCommand();
  });

program
  .command("register")
  .description("Stake into the ResolverRegistry so this resolver is eligible to fill orders.")
  .argument("[amount]", "Stake amount in the registry's stake asset (default: minStake)")
  .action(async (amount?: string) => {
    await registerCommand(amount);
  });

program
  .command("status")
  .description("Print the current registration status of this resolver.")
  .action(async () => {
    await statusCommand();
  });

program
  .command("unregister")
  .description("Withdraw stake and unregister this resolver.")
  .action(async () => {
    await unregisterCommand();
  });

program
  .command("check")
  .description("Run a preflight check to verify if the resolver is active in configured registries.")
  .action(async () => {
    const { checkCommand } = await import("./commands/check.js");
    await checkCommand();
  });

program
  .command("preflight")
  .description("Validate local configuration and prints actionable setup guidance before registration or staking.")
  .action(async () => {
    const { preflightCommand } = await import("./commands/preflight.js");
    const code = await preflightCommand();
    process.exit(code);
  });

program
  .command("readiness")
  .description(
    "Dry-run onboarding check: validates env, RPC reachability, resolver registry address, " +
      "and detects the resolver's EVM/Stellar addresses without printing private keys. " +
      "Exits non-zero when required config is missing. No transactions are submitted."
  )
  .action(async () => {
    const code = await readinessCommand();
    process.exit(code);
  });


program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
