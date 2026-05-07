#!/usr/bin/env node
/**
 * Post-build CI smoke checks per skill §13 + plan §"Phase 1 acceptance gates".
 *
 * Run after `pnpm build` (or in CI release workflow). Asserts:
 *   1. dist/main/index.js exists and matches package.json `main` field.
 *   2. dist/preload/index.cjs exists, is CJS, exposes contextBridge, NEVER raw ipcRenderer.
 *   3. dist/renderer/index.html has strict CSP — no `'unsafe-inline'`, no `'unsafe-eval'`.
 *   4. dist/renderer/assets/*.js bundle has no `localStorage`/`sessionStorage`/`dangerouslySetInnerHTML`.
 *   5. Built CSP includes mandatory directives: default-src 'self', object-src 'none',
 *      base-uri 'none', frame-ancestors 'none', form-action 'none'.
 *
 * Exit non-zero on any violation.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const distMain = path.join(root, "dist", "main", "index.js");
const distPreload = path.join(root, "dist", "preload", "index.cjs");
const distRendererHtml = path.join(root, "dist", "renderer", "index.html");
const distRendererAssets = path.join(root, "dist", "renderer", "assets");
const pkgJson = path.join(root, "package.json");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const failures = [];

function check(label, fn) {
  try {
    fn();
    console.log(`${GREEN}✓${RESET} ${label}`);
  } catch (e) {
    console.log(`${RED}✗${RESET} ${label}`);
    console.log(`  ${e.message}`);
    failures.push({ label, message: e.message });
  }
}

// 1. main entrypoint
check("package.json `main` resolves to existing file", () => {
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8"));
  if (!pkg.main) throw new Error("package.json missing `main` field");
  const resolved = path.join(root, pkg.main);
  if (!existsSync(resolved)) {
    throw new Error(`package.json main = "${pkg.main}" but file not found at ${resolved}`);
  }
});

// 2. preload bundle
check("preload bundle is CJS + uses contextBridge + NO raw ipcRenderer exposure", () => {
  if (!existsSync(distPreload)) throw new Error(`missing: ${distPreload}`);
  const src = readFileSync(distPreload, "utf8");
  if (!src.includes('require("electron")') && !src.includes("require('electron')")) {
    throw new Error("preload bundle is not CJS-style (no `require('electron')` found)");
  }
  if (!src.includes("contextBridge")) {
    throw new Error("preload bundle does not use contextBridge.exposeInMainWorld");
  }
  // Heuristic: preload may use ipcRenderer.invoke under the hood; we forbid only
  // exposing it directly. exposeInMainWorld must be called with `vex` as first arg.
  if (!src.includes("exposeInMainWorld") || !src.includes('"vex"')) {
    throw new Error("preload does not expose `window.vex`");
  }
  // Reject patterns that would leak the entire ipcRenderer to renderer.
  const leaks = [
    /exposeInMainWorld\(\s*["']vex["']\s*,\s*ipcRenderer\b/,
    /exposeInMainWorld\(\s*["']ipcRenderer["']/,
    /exposeInMainWorld\(\s*["'][^"']+["']\s*,\s*\{\s*invoke\s*:\s*ipcRenderer\.invoke\b/,
  ];
  for (const pattern of leaks) {
    if (pattern.test(src)) {
      throw new Error(`preload leaks ipcRenderer surface (matched ${pattern.source})`);
    }
  }
});

// 3. renderer CSP
check("renderer index.html CSP — no unsafe-inline / unsafe-eval", () => {
  if (!existsSync(distRendererHtml)) throw new Error(`missing: ${distRendererHtml}`);
  const html = readFileSync(distRendererHtml, "utf8");
  // Multiline-tolerant regex: <meta ... http-equiv="CSP" ... content="...">
  // CSP can contain single quotes (e.g. 'self'), so the capture group must
  // stop only on the surrounding double quote. We anchor the surrounding
  // attribute quote to ".
  const cspMatch = html.match(/<meta\b[^>]*?http-equiv="Content-Security-Policy"[^>]*?content="([^"]+)"/is);
  if (!cspMatch) {
    throw new Error("no Content-Security-Policy <meta> tag found");
  }
  const csp = cspMatch[1];
  if (csp.includes("'unsafe-inline'") || csp.includes('"unsafe-inline"')) {
    throw new Error(`CSP contains 'unsafe-inline': ${csp}`);
  }
  if (csp.includes("'unsafe-eval'") || csp.includes('"unsafe-eval"')) {
    throw new Error(`CSP contains 'unsafe-eval': ${csp}`);
  }
  // Mandatory hardening directives
  const required = [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ];
  for (const directive of required) {
    if (!csp.includes(directive)) {
      throw new Error(`CSP missing required directive: ${directive}`);
    }
  }
});

// 4. renderer source hygiene (NOT built bundle — React's own API definitions
// would always trip a built-bundle scan for `dangerouslySetInnerHTML`).
check("renderer source — no localStorage/sessionStorage/dangerouslySetInnerHTML/eval in our code", () => {
  const srcDir = path.join(root, "src", "renderer");
  if (!existsSync(srcDir)) throw new Error(`missing: ${srcDir}`);
  const violations = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === "test") continue;
        walk(full);
      } else if (/\.(tsx?|jsx?|mts|cts)$/.test(ent.name)) {
        const src = readFileSync(full, "utf8");
        if (/\blocalStorage\.(setItem|getItem|removeItem)\b/.test(src)) {
          violations.push(`${full}: uses localStorage (allowed only via Zustand persist whitelist)`);
        }
        if (/\bsessionStorage\.(setItem|getItem|removeItem)\b/.test(src)) {
          violations.push(`${full}: uses sessionStorage (forbidden)`);
        }
        // JSX attribute use only (not React's internal definition).
        if (/\bdangerouslySetInnerHTML\s*=/.test(src)) {
          violations.push(`${full}: uses dangerouslySetInnerHTML JSX attribute (forbidden)`);
        }
        if (/\beval\s*\(/.test(src)) {
          violations.push(`${full}: contains eval()`);
        }
      }
    }
  };
  walk(srcDir);
  if (violations.length > 0) {
    throw new Error(`Renderer source violations:\n    ${violations.join("\n    ")}`);
  }
});

// 5. main bundle hygiene (top-level)
check("main bundle — entrypoint exists + uses single-instance lock", () => {
  if (!existsSync(distMain)) throw new Error(`missing: ${distMain}`);
  const src = readFileSync(distMain, "utf8");
  if (!src.includes("requestSingleInstanceLock")) {
    throw new Error("main bundle missing single-instance lock guard");
  }
  if (!src.includes("registerSchemesAsPrivileged")) {
    throw new Error("main bundle missing custom protocol registration");
  }
  if (!src.includes("setPermissionRequestHandler")) {
    throw new Error("main bundle missing permission deny handlers");
  }
});

if (failures.length > 0) {
  console.log(`\n${RED}${failures.length} build artifact check(s) FAILED.${RESET}\n`);
  process.exit(1);
}
console.log(`\n${GREEN}All build artifact checks passed.${RESET}\n`);
