/// <reference types="vitest/config" />
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(__dirname, "src/renderer");

/**
 * Production CSP is strict (skill §7). Vite's dev server injects HMR
 * styles as dynamically-created <style> elements and uses eval() in the
 * HMR client — both of which strict CSP blocks. Skill §7 explicitly
 * allows dev relaxations on 127.0.0.1:5173.
 *
 * This plugin rewrites the <meta http-equiv="Content-Security-Policy">
 * tag in `serve` (dev) mode only. The `build` output keeps the strict
 * CSP from index.html verbatim, so the postbuild check
 * (`scripts/check-build-artifacts.mjs` — gate #3) still asserts no
 * `'unsafe-inline'` / `'unsafe-eval'` in production artifacts.
 */
function devCspRelaxer(isDev: boolean): Plugin {
  const DEV_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' ws://127.0.0.1:5173 http://127.0.0.1:5173",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");

  return {
    name: "vex-dev-csp-relaxer",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (!isDev) return html;
        const replaced = html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]+"\s*\/?>/i,
          `<meta http-equiv="Content-Security-Policy" content="${DEV_CSP}" />`
        );
        // Fail-fast: if the regex did not match (markup format changed), the
        // dev session would silently inherit the strict CSP and Tailwind
        // utilities would be blocked again. Better to crash the dev server
        // than ship a confusingly-broken UI.
        if (replaced === html) {
          throw new Error(
            "[vex-dev-csp-relaxer] could not find <meta http-equiv=\"Content-Security-Policy\" ...> in index.html — dev CSP relax not applied. Check src/renderer/index.html for format drift."
          );
        }
        return replaced;
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  root: rendererRoot,
  appType: "spa",
  base: command === "serve" ? "/" : "./",
  envDir: __dirname,
  envPrefix: "VITE_",
  publicDir: path.resolve(rendererRoot, "public"),

  plugins: [
    react(),
    tailwindcss(),
    devCspRelaxer(command === "serve"),
  ],

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
