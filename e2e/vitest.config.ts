import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkSrc = path.resolve(here, "../packages/sdk/src");

// Resolve @oversync/sdk to its TypeScript source so the e2e tests don't
// require a separate build step. Vitest handles .ts via its TS loader; the
// .js extensions inside the SDK source are resolved by bundler-style
// moduleResolution, mirroring how the SDK's own unit tests run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"]
  },
  resolve: {
    alias: [
      { find: /^@oversync\/sdk\/secrets$/, replacement: path.join(sdkSrc, "secrets/index.ts") },
      { find: /^@oversync\/sdk\/ethereum$/, replacement: path.join(sdkSrc, "ethereum/index.ts") },
      { find: /^@oversync\/sdk\/soroban$/, replacement: path.join(sdkSrc, "soroban/index.ts") },
      { find: /^@oversync\/sdk\/state-machine$/, replacement: path.join(sdkSrc, "state-machine/index.ts") },
      { find: /^@oversync\/sdk\/types$/, replacement: path.join(sdkSrc, "types/index.ts") },
      { find: /^@oversync\/sdk$/, replacement: path.join(sdkSrc, "index.ts") }
    ]
  }
});
