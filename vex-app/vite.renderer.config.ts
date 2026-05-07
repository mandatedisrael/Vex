/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(__dirname, "src/renderer");

export default defineConfig(({ command }) => ({
  root: rendererRoot,
  appType: "spa",
  base: command === "serve" ? "/" : "./",
  envDir: __dirname,
  envPrefix: "VITE_",
  publicDir: path.resolve(rendererRoot, "public"),

  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": rendererRoot,
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },

  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: {
      host: "127.0.0.1",
      port: 5173,
      clientPort: 5173,
      overlay: true,
    },
  },

  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },

  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: command === "serve",
    target: "es2024",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: path.resolve(rendererRoot, "index.html"),
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.resolve(rendererRoot, "test/setup.ts")],
  },
}));
