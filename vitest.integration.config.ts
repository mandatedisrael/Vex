import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@tools": resolve(__dirname, "src/tools"),
      "@utils": resolve(__dirname, "src/utils"),
      "@config": resolve(__dirname, "src/config"),
      "@echo-agent": resolve(__dirname, "src/echo-agent"),
    },
  },
  test: {
    include: ["src/__tests__/integration/**/*.int.test.ts"],
    globals: false,
    environment: "node",
    globalSetup: ["src/__tests__/integration/setup/globalSetup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Serialize EVERYTHING — one Postgres, one worker, one file at a time.
    // `fileParallelism: false` stops separate files from racing each other's
    // `resetDb`; `maxWorkers/minWorkers: 1` forces a single worker regardless
    // of pool choice (flat config per Vitest 4's `poolOptions` rework).
    fileParallelism: false,
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
