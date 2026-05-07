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
    outDir: path.resolve(__dirname, "dist/preload"),
    emptyOutDir: true,
    target: "node22",
    sourcemap: true,
    minify: false,
    lib: {
      entry: path.resolve(__dirname, "src/preload/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    rollupOptions: {
      external: ["electron"],
      output: {
        format: "cjs",
        entryFileNames: "index.cjs",
      },
    },
  },
});
