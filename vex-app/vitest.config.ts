import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@": path.resolve(__dirname, "src/renderer"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: [],
  },
});
