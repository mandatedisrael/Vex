/**
 * Shell design-language guard (S7) — THE PROTOCOL DESK stays locked.
 *
 * The shell's visual law (globals.css `[data-vex-shell]` scope): depth is
 * solid luminance + hairlines, never glass or glow; one accent family
 * (#3275f8 via the --vex-accent tokens) and ZERO of the legacy gray-blue
 * raw hexes; no ShinyText gradient chrome. This test turns each law into
 * a red build instead of a review comment:
 *
 *   1. /backdrop-blur(?!-none)/ — no backdrop-filter glass anywhere in the
 *      shell. `backdrop-blur-none` is EXEMPT by the lookahead: it is the
 *      sanctioned per-usage override that NEUTRALIZES the dialog base's
 *      `backdrop:backdrop-blur-sm` (components/ui/dialog.tsx stays a
 *      shared primitive with its stock default; see WHITELIST).
 *   2. /ShinyText|vex-shiny-text/ — the shine chrome died in S7 (component
 *      + @keyframes deleted); nothing may re-import it.
 *   3. the legacy gray-blue hex family — replaced by --vex-accent tokens.
 *   4. /shadow-\[0_0_/ — resting glow. Depth never comes from shadows.
 *
 * Scope: every non-test .ts/.tsx under features/appShell, plus the two
 * shared primitives the shell composes for popover/dialog chrome
 * (components/ui/dialog.tsx, components/ui/select-menu.tsx). Onboarding
 * surfaces are a separate, finished language and are NOT scanned.
 *
 * Sources are read via `import.meta.glob(..., ?raw)` — Vite inlines the
 * file contents at transform time — instead of `node:fs`, so this test
 * typechecks inside the renderer TS project WITHOUT pulling @types/node
 * into the renderer program (the renderer/main type boundary stays clean).
 * A raw text scan (not an AST) is correct here: every banned pattern is a
 * Tailwind class fragment or hex literal that can only appear as text.
 */

import { describe, expect, it } from "vitest";

// ── Scope (glob keys are relative to this __tests__ directory) ────────────
// Transform-time file inlining happens on Vite's side; on slow filesystems
// (WSL drvfs mounts) the IMPORT of this module is the expensive part, not
// the test body — module-level eager globs keep the test itself fast.
const SHELL_SOURCES: Record<string, string> = {
  ...import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/__tests__/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob<string>(
    [
      "../../../components/ui/dialog.tsx",
      "../../../components/ui/select-menu.tsx",
    ],
    { query: "?raw", import: "default", eager: true },
  ),
};

/** Normalize a glob key to a stable renderer-relative path. */
function normalizeKey(key: string): string {
  if (key.startsWith("../../../components/ui/")) {
    return `components/ui/${key.slice("../../../components/ui/".length)}`;
  }
  return `features/appShell/${key.replace(/^\.\.\//, "")}`;
}

interface BannedPattern {
  readonly name: string;
  readonly regex: RegExp;
}

// NOTE: no `g` flags — each regex is used via .test() per file, and a
// sticky/global regex would carry lastIndex state across files.
const BANNED: readonly BannedPattern[] = [
  { name: "backdrop-blur (glass)", regex: /backdrop-blur(?!-none)/ },
  { name: "ShinyText chrome", regex: /ShinyText|vex-shiny-text/ },
  {
    name: "legacy gray-blue raw hex",
    regex: /#(?:6f91ff|8da5ff|adc0ff|3758ff|4668ff|9bb2ff|4d72ff|b2a3ff)/i,
  },
  { name: "resting glow shadow", regex: /shadow-\[0_0_/ },
];

/**
 * Sanctioned exceptions. Keep this list EMPTY-by-default: fix the source
 * before whitelisting. Each entry exempts ONE (file, pattern) pair.
 */
interface WhitelistEntry {
  /** Path relative to vex-app/src/renderer, posix separators. */
  readonly file: string;
  /** Must equal a BannedPattern.name. */
  readonly pattern: string;
  readonly reason: string;
}

const WHITELIST: readonly WhitelistEntry[] = [
  {
    file: "components/ui/dialog.tsx",
    pattern: "backdrop-blur (glass)",
    reason:
      "Shared <dialog> primitive keeps its stock backdrop:backdrop-blur-sm " +
      "default (S7 deliberately left the base untouched); every shell usage " +
      "overrides it with backdrop:backdrop-blur-none on DialogContent.",
  },
];

interface Violation {
  readonly file: string;
  readonly pattern: string;
}

function scanSource(file: string, source: string): Violation[] {
  const violations: Violation[] = [];
  for (const banned of BANNED) {
    if (!banned.regex.test(source)) continue;
    const whitelisted = WHITELIST.some(
      (w) => w.file === file && w.pattern === banned.name,
    );
    if (!whitelisted) violations.push({ file, pattern: banned.name });
  }
  return violations;
}

describe("shell design guard (S7)", () => {
  // Explicit I/O budget: importing this module inlines every appShell
  // source file — I/O-bound at transform time, and the default 5s test
  // timeout is not generous on slow filesystems (WSL drvfs mounts). The
  // longer timeout does not weaken the guard; the assertion stays
  // byte-identical.
  it(
    "no shell source file uses glass, shine, legacy hexes, or resting glow",
    { timeout: 60_000 },
    () => {
      const entries = Object.entries(SHELL_SOURCES);
      // Sanity: the globs actually found the appShell tree + both extras.
      expect(entries.length).toBeGreaterThan(10);
      const files = entries.map(([key]) => normalizeKey(key));
      expect(files).toContain("components/ui/dialog.tsx");
      expect(files).toContain("components/ui/select-menu.tsx");

      const violations: Violation[] = [];
      for (const [key, source] of entries) {
        violations.push(...scanSource(normalizeKey(key), source));
      }

      // If this fails: replace the offending chrome with the --vex-* tokens
      // (accent → var(--vex-accent), readable blue text → --vex-accent-text,
      // borders → --vex-accent-border[-strong], fills → --vex-accent-fill-*)
      // — do NOT add a whitelist entry unless the file is a shared primitive
      // whose default is overridden at every shell call site.
      const rendered = violations.map((v) => `${v.file} :: ${v.pattern}`);
      expect(rendered).toEqual([]);

      // Stale-whitelist check: every entry must point at a scanned file.
      for (const entry of WHITELIST) {
        expect(files, `stale whitelist entry: ${entry.file}`).toContain(
          entry.file,
        );
        expect(BANNED.map((b) => b.name)).toContain(entry.pattern);
      }
    },
  );

  // ── Pattern self-tests (mutation coverage for the lookahead subtlety) ──
  const matchNames = (source: string): readonly string[] =>
    BANNED.filter((b) => b.regex.test(source)).map((b) => b.name);

  it("flags real glass but NOT the sanctioned backdrop-blur-none override", () => {
    expect(matchNames("backdrop-blur-2xl")).toContain("backdrop-blur (glass)");
    expect(matchNames("backdrop:backdrop-blur-sm")).toContain(
      "backdrop-blur (glass)",
    );
    expect(matchNames("backdrop:backdrop-blur-none")).toEqual([]);
  });

  it("flags the legacy hex family case-insensitively, not the accent", () => {
    expect(matchNames("text-[#8da5ff]")).toContain("legacy gray-blue raw hex");
    expect(matchNames("bg-[#6F91FF]")).toContain("legacy gray-blue raw hex");
    // #3275f8 is the accent ROOT — it lives in globals.css token definitions
    // and is not part of this hex ban (CSS is out of scope here).
    expect(matchNames("#3275f8")).toEqual([]);
  });

  it("flags resting glow and shine chrome", () => {
    expect(matchNames("shadow-[0_0_80px_rgba(22,68,190,0.28)]")).toContain(
      "resting glow shadow",
    );
    expect(matchNames('import { ShinyText } from "x"')).toContain(
      "ShinyText chrome",
    );
    expect(matchNames("vex-shiny-text")).toContain("ShinyText chrome");
    // Directional hover shadows are not resting glow.
    expect(matchNames("shadow-[0_2px_8px]")).toEqual([]);
  });
});
