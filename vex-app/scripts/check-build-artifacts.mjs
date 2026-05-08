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
 *   6. Brand assets in dist/renderer/ — exist, decode cleanly, match expected
 *      dimensions, fit byte budget, carry no EXIF/IPTC/XMP metadata
 *      (privacy hygiene for self-custodial wallet binary).
 *   7. Compiled CSS contains no bare `--color-*` references in property values
 *      (must be wrapped in `var(...)`). Catches Tailwind v4 arbitrary-value
 *      footgun: `text-[--color-foo]` compiles to `color:--color-foo` (broken)
 *      instead of `color:var(--color-foo)`. Use `text-[var(--color-foo)]` or
 *      a semantic alias.
 *   8. Renderer source must not use the bare Tailwind arbitrary-color syntax
 *      `[--color-x]`. Required form: semantic alias (`bg-card`, `text-success`)
 *      or explicit `[var(--color-x)]`. Catches regressions BEFORE build.
 *
 * Exit non-zero on any violation.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

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

async function checkAsync(label, fn) {
  try {
    await fn();
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
        if (
          ent.name === "node_modules" ||
          ent.name === "test" ||
          ent.name === "__tests__"
        ) {
          continue;
        }
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

// 6. brand assets — exist, decode, expected dimensions, byte budget, no EXIF
const BRAND_ASSETS = [
  { file: "logo.png", width: 965, height: 965, format: "png", maxBytes: 25_000 },
  { file: "logo_clean.png", width: 500, height: 500, format: "png", maxBytes: 40_000 },
  { file: "vex.jpg", width: 1254, height: 1254, format: "jpeg", maxBytes: 130_000 },
];

await checkAsync("brand assets — exist, decode, dimensions, byte budget, no EXIF/IPTC/XMP", async () => {
  const issues = [];
  for (const expect of BRAND_ASSETS) {
    const full = path.join(root, "dist", "renderer", expect.file);
    if (!existsSync(full)) {
      issues.push(`${expect.file}: missing in dist/renderer/`);
      continue;
    }
    const size = statSync(full).size;
    if (size > expect.maxBytes) {
      issues.push(`${expect.file}: ${size} bytes exceeds budget ${expect.maxBytes}`);
    }
    let meta;
    try {
      meta = await sharp(full).metadata();
    } catch (e) {
      issues.push(`${expect.file}: cannot decode (${e.message})`);
      continue;
    }
    if (meta.format !== expect.format) {
      issues.push(`${expect.file}: format ${meta.format}, expected ${expect.format}`);
    }
    if (meta.width !== expect.width || meta.height !== expect.height) {
      issues.push(
        `${expect.file}: ${meta.width}x${meta.height}, expected ${expect.width}x${expect.height}`
      );
    }
    if (meta.exif) issues.push(`${expect.file}: carries EXIF metadata`);
    if (meta.iptc) issues.push(`${expect.file}: carries IPTC metadata`);
    if (meta.xmp) issues.push(`${expect.file}: carries XMP metadata`);
  }
  if (issues.length > 0) {
    throw new Error(`Brand asset issues:\n    ${issues.join("\n    ")}`);
  }
});

// 7. compiled CSS must wrap `--color-*` references in `var(...)`.
// First gate #7 used `\b--color-` which never matches (both sides are non-word
// characters, so the boundary never fires) — codex 2026-05-08 turn 2. Replaced
// with a declaration-position scan: find every `--color-x` occurrence in
// VALUE context (after a `:` within the same declaration) that is NOT
// wrapped in `var(...)`.
check("renderer CSS — no bare --color-* references (must be wrapped in var(...))", () => {
  if (!existsSync(distRendererAssets)) {
    throw new Error(`missing assets dir: ${distRendererAssets}`);
  }
  const cssFiles = readdirSync(distRendererAssets).filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error(`no compiled CSS in ${distRendererAssets}`);
  }
  const violations = [];
  for (const file of cssFiles) {
    const raw = readFileSync(path.join(distRendererAssets, file), "utf8");
    // Strip block comments first.
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    const bare = [];
    for (const m of css.matchAll(/--color-[a-z][a-z0-9-]*/g)) {
      const idx = m.index;
      // Reject when wrapped in `var(` — both literal (declarations) and
      // backslash-escaped (CSS class selectors generated by Tailwind for
      // arbitrary values like `.text-\[var\(--color-x\)\]`).
      if (idx >= 4 && css.slice(idx - 4, idx) === "var(") continue;
      if (idx >= 5 && css.slice(idx - 5, idx) === "var\\(") continue;
      // Selectors live before `{`. If the next significant char going
      // forward is `{` (rule open), this `--color-x` is part of a selector
      // class name (e.g. Tailwind's escaped arbitrary-value class), not a
      // declaration value. Declarations end in `;` or `}`.
      let inSelector = false;
      for (let i = idx; i < css.length; i += 1) {
        const ch = css[i];
        if (ch === ";" || ch === "}") break;
        if (ch === "{") {
          inSelector = true;
          break;
        }
      }
      if (inSelector) continue;
      // Walk back to nearest declaration boundary to determine if this
      // occurrence is a custom-property NAME (left of `:`) or a VALUE
      // reference (right of `:` / inside a function arg).
      let context = "name";
      for (let i = idx - 1; i >= 0; i -= 1) {
        const ch = css[i];
        if (ch === ";" || ch === "{" || ch === "}") break;
        if (ch === ":" || ch === "," || ch === "(") {
          context = "value";
          break;
        }
      }
      if (context === "value") bare.push(m[0]);
    }
    if (bare.length > 0) {
      const sample = bare.slice(0, 5).join(", ");
      violations.push(`${file}: ${bare.length} bare --color refs (${sample})`);
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Bare --color refs (use var(--color-x) or semantic alias):\n    ${violations.join("\n    ")}`
    );
  }
});

// 8. renderer source must NOT use the Tailwind v4 bare arbitrary-color syntax
// `text-[--color-x]` / `bg-[--color-x]` / etc. Required form is either a
// semantic alias (`text-foreground`, `bg-card`, `bg-success`) or an explicit
// `[var(--color-x)]` wrapper. Catches the regression class BEFORE build —
// gate #7 above is the dist-side safety net.
check("renderer source — no bare `*-[--color-*]` Tailwind arbitrary syntax", () => {
  const srcDir = path.join(root, "src", "renderer");
  if (!existsSync(srcDir)) throw new Error(`missing: ${srcDir}`);
  const violations = [];
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name === "node_modules" ||
          ent.name === "test" ||
          ent.name === "__tests__"
        ) {
          continue;
        }
        walk(full);
      } else if (/\.(tsx?|jsx?|css)$/.test(ent.name)) {
        const src = readFileSync(full, "utf8");
        // Match `[--color-x]` NOT preceded by `[var(`.
        const re = /\[--color-[a-z][a-z0-9-]*\]/g;
        const hits = [];
        for (const m of src.matchAll(re)) {
          // Allow `[var(--color-x)]` — the bracket pair would be `[var(...`,
          // not `[--color-`, so the pattern above already excludes it.
          hits.push(m[0]);
        }
        if (hits.length > 0) {
          const sample = hits.slice(0, 3).join(", ");
          violations.push(
            `${path.relative(root, full)}: ${hits.length} bare arbitrary refs (${sample}) — use semantic alias or [var(...)]`
          );
        }
      }
    }
  };
  walk(srcDir);
  if (violations.length > 0) {
    throw new Error(`Bare Tailwind arbitrary refs:\n    ${violations.join("\n    ")}`);
  }
});

if (failures.length > 0) {
  console.log(`\n${RED}${failures.length} build artifact check(s) FAILED.${RESET}\n`);
  process.exit(1);
}
console.log(`\n${GREEN}All build artifact checks passed.${RESET}\n`);
