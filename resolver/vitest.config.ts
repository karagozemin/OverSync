import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const sdkSrc = path.resolve(here, "../packages/sdk/src");

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
    server: {
      deps: {
        external: [/^node:/]
      }
    }
  },
  resolve: {
    alias: [
      { find: /^@oversync\/sdk\/types$/, replacement: path.join(sdkSrc, "types/index.ts") },
      { find: /^@oversync\/sdk\/secrets$/, replacement: path.join(sdkSrc, "secrets/index.ts") },
      { find: /^@oversync\/sdk\/ethereum$/, replacement: path.join(sdkSrc, "ethereum/index.ts") },
      { find: /^@oversync\/sdk\/soroban$/, replacement: path.join(sdkSrc, "soroban/index.ts") },
      { find: /^@oversync\/sdk\/state-machine$/, replacement: path.join(sdkSrc, "state-machine/index.ts") },
      { find: /^@oversync\/sdk$/, replacement: path.join(sdkSrc, "index.ts") }
    ]
  }
});
