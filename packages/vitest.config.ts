import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@oversync/sdk": new URL("./src/index.ts", import.meta.url).pathname,
    },
  },
});