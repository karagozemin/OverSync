import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
      { find: /^@oversync\/sdk\/logging$/, replacement: path.join(sdkSrc, "logging/index.ts") }
    ]
  }
});
