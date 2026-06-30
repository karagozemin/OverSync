import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    pool: "forks",
    server: {
      deps: {
        external: [/^node:/],
        inline: ['@oversync/sdk']
      }
    }
  }
});
