#!/usr/bin/env node
import { main } from "./deployed-hash-verifier.mjs";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
