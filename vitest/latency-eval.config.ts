import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@tools": resolve(root, "src/tools"),
      "@utils": resolve(root, "src/utils"),
      "@config": resolve(root, "src/config"),
      "@vex-agent": resolve(root, "src/vex-agent"),
    },
  },
  test: {
    include: ["src/__tests__/eval/discovery-latency.int.ts"],
    globals: false,
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    pool: "threads",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
