/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/main"),
    emptyOutDir: true,
    target: "node22",
    sourcemap: true,
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/main/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "electron",
        "electron-log",
        "electron-log/main",
        "electron-log/main.js",
        "electron-updater",
        "@sentry/electron/main",
        "pg",
        /^node:/,
        "node:fs",
        "node:fs/promises",
        "node:path",
        "node:os",
        "node:url",
        "node:crypto",
        "node:child_process",
      ],
      output: {
        format: "esm",
        entryFileNames: "[name].js",
      },
    },
  },
});
