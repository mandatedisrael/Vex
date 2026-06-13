/**
 * ADVISORY-ONLY ARCHITECTURE GREP-GATE (WAVE 0, TEST 0.1) — the single most
 * security-critical tripwire against memory-poisoning-into-execution.
 *
 * THREAT (ADV-1 / OD-1): a crafted "lesson" ("always 10x size on TOKEN") must
 * NEVER reach a sizing input, an approval auto-grant, or a wallet intent. Long-
 * term-memory RECALL (top-K vector search / the long_memory_* tools) is the
 * poisoning vector: it is the surface that surfaces stored lessons. Today the
 * advisory-only invariant — "the execution/sizing/approval boundary never pulls
 * recall" — is enforced ONLY by convention. This test makes it a deterministic
 * gate: the day someone adds `import { recallLongMemoryTopK }` (or any other
 * recall/retrieval import) into the turn loop or a sizing/approval/wallet repo,
 * this suite reds.
 *
 * SCOPE — the high-risk EXECUTION boundary ONLY:
 *   - everything under `src/vex-agent/engine/core/**` (the turn loop / exec core)
 *   - the execution/sizing/approval repos:
 *       db/repos/{wallet-intents,approval-intents,approvals,swap-prequotes}.ts
 *
 * WHAT IS BANNED (the poisoning vector, NOT all knowledge access):
 *   - any import from a long-memory TOOL module
 *       (`@vex-agent/tools/internal/long-memory/*` — search/get/history/suggest)
 *   - any import from the long-memory RECALL repo
 *       (`@vex-agent/db/repos/knowledge/recall`)
 *   - any import of a recall/retrieval NAMED symbol from ANY module — this
 *     catches the barrel-routed case where recall is re-exported through
 *     `@vex-agent/db/repos/knowledge`
 *       (recallLongMemoryTopK / handleLongMemory{Search,Get,History} /
 *        searchLongMemory / long_memory_search / expandViaGraph)
 *   - any import from `@vex-agent/memory/long-memory-retrieval-policy`
 *
 * WHAT IS NOT BANNED (per Lead Dev — do NOT blanket-ban all knowledge imports):
 *   general knowledge type / source-policy / hot-context imports are LEGITIMATE
 *   elsewhere (memory/turn-context.ts, engine/prompts/memory-section.ts use
 *   hot-context/source-policy; the manager writes knowledge). The gate targets
 *   RECALL/RETRIEVAL specifically, not knowledge access in general.
 *
 * ALLOWLIST of legitimate recall consumers (encoded so the gate scopes correctly
 * even if it is later widened to scan the whole tree):
 *   - the 4 read-only long-memory tools  (tools/internal/long-memory/*)
 *   - the memory manager                  (memory/manager/*)
 *   - the retrieval policy itself          (memory/long-memory-retrieval-policy.ts)
 *
 * MECHANISM: scan IMPORT statements ONLY (not arbitrary text / comments), so a
 * recall symbol named in a comment or a string never false-positives. We build
 * the list of offending (file, importLine) pairs and assert it is EMPTY.
 *
 * Pure / no DB.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

// Repo root (this file lives at <root>/src/__tests__/architecture/).
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const VEX_AGENT = resolve(REPO_ROOT, "src", "vex-agent");

// ── The execution boundary under guard ──────────────────────────────

const ENGINE_CORE_DIR = resolve(VEX_AGENT, "engine", "core");
const EXEC_REPO_FILES = [
  resolve(VEX_AGENT, "db", "repos", "wallet-intents.ts"),
  resolve(VEX_AGENT, "db", "repos", "approval-intents.ts"),
  resolve(VEX_AGENT, "db", "repos", "approvals.ts"),
  resolve(VEX_AGENT, "db", "repos", "swap-prequotes.ts"),
] as const;

// ── Recall/retrieval import signatures (the poisoning vector) ────────

/**
 * Import MODULE specifiers that are recall/retrieval by path. Matched against
 * the `from "<specifier>"` of an import statement.
 */
const BANNED_MODULE_SPECIFIERS: readonly RegExp[] = [
  // The 4 read-only long-memory TOOLS (search/get/history/suggest).
  /@vex-agent\/tools\/internal\/long-memory(\/|["']|$)/,
  // The long-memory RECALL repo module (top-K vector search lives here).
  /@vex-agent\/db\/repos\/knowledge\/recall(\.js)?["']/,
  // The retrieval policy (ranking/blend/expansion of recalled lessons).
  /@vex-agent\/memory\/long-memory-retrieval-policy(\.js)?["']/,
];

/**
 * Recall/retrieval NAMED symbols. Banned no matter which module they are
 * imported from — this is what catches the BARREL-ROUTED case, where recall is
 * re-exported through `@vex-agent/db/repos/knowledge`. These names are the
 * retrieval surface specifically (top-K recall, the long_memory_* handlers,
 * graph expansion of recalled neighbors) — NOT plain getById / type imports.
 */
const BANNED_SYMBOLS: readonly string[] = [
  "recallLongMemoryTopK",
  "handleLongMemorySearch",
  "handleLongMemoryGet",
  "handleLongMemoryHistory",
  "handleLongMemorySuggest",
  "searchLongMemory",
  "long_memory_search",
  "expandViaGraph",
];

// ── Static import-statement scan (NOT arbitrary text) ───────────────

interface Violation {
  file: string;
  importLine: string;
  reason: string;
}

/**
 * Extract whole `import ... from "..."` statements (including multi-line named
 * imports) plus bare side-effect imports. Comments are NOT parsed — only real
 * import statements — so a recall name in a comment never false-positives.
 */
function extractImportStatements(source: string): string[] {
  // Strip line + block comments first so a recall symbol mentioned in a doc
  // comment cannot register as an import.
  const noComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const statements: string[] = [];
  // `import ... from "x"` and `export ... from "x"` (re-export) and bare
  // `import "x"` — the `[\s\S]*?` spans multi-line named-import blocks.
  const fromRe = /\b(?:import|export)\b[\s\S]*?from\s*["'][^"']+["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(noComments)) !== null) statements.push(m[0]);
  const bareRe = /\bimport\s*["'][^"']+["']/g;
  while ((m = bareRe.exec(noComments)) !== null) statements.push(m[0]);
  return statements;
}

function findViolations(file: string): Violation[] {
  const source = readFileSync(file, "utf8");
  const rel = file.startsWith(REPO_ROOT) ? file.slice(REPO_ROOT.length + 1) : file;
  const out: Violation[] = [];

  for (const stmt of extractImportStatements(source)) {
    const oneLine = stmt.replace(/\s+/g, " ").trim();

    for (const re of BANNED_MODULE_SPECIFIERS) {
      if (re.test(stmt)) {
        out.push({
          file: rel,
          importLine: oneLine,
          reason: `imports a long-memory RECALL/retrieval module (${re.source})`,
        });
      }
    }

    // Symbol bans only apply to the NAMED-import binding section (between the
    // braces), so a substring inside the module path can't trip them.
    const braceMatch = stmt.match(/\{([\s\S]*?)\}/);
    const namedSection = braceMatch ? braceMatch[1] : "";
    const namedBindings = namedSection
      .split(",")
      .map((s) => s.replace(/\btype\b/, "").trim())
      // `foo as bar` → the imported name is the LHS.
      .map((s) => s.split(/\s+as\s+/)[0]!.trim())
      .filter(Boolean);
    for (const sym of BANNED_SYMBOLS) {
      if (namedBindings.includes(sym)) {
        out.push({
          file: rel,
          importLine: oneLine,
          reason: `imports the recall/retrieval symbol "${sym}" (banned at the execution boundary)`,
        });
      }
    }
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("advisory-only boundary (TEST 0.1 — memory-poisoning tripwire)", () => {
  const boundaryFiles = [...walkTs(ENGINE_CORE_DIR), ...EXEC_REPO_FILES];

  it("collects the execution boundary it guards (sanity: the files exist)", () => {
    // The four exec repos MUST exist (the gate is meaningless if a path 404s).
    for (const f of EXEC_REPO_FILES) {
      expect(statSync(f).isFile()).toBe(true);
    }
    // engine/core has many turn-loop files; assert we actually scanned some.
    expect(boundaryFiles.length).toBeGreaterThan(10);
  });

  it("no execution/sizing/approval/wallet boundary file imports long-memory RECALL", () => {
    const violations = boundaryFiles.flatMap(findViolations);

    // A violation here means an un-vetted, possibly poisoned long-term lesson is
    // one import away from a sizing / approval / wallet-intent input — the exact
    // memory-poisoning-into-execution failure OD-1 / ADV-1 forbids.
    const message =
      violations.length === 0
        ? ""
        : "advisory-only boundary VIOLATED — recall/retrieval is wired into the execution boundary " +
          "(an un-vetted lesson is one import from sizing/approval/wallet):\n" +
          violations.map((v) => `  - ${v.file}: ${v.reason}\n      ${v.importLine}`).join("\n");

    expect(violations, message).toEqual([]);
  });

  it("the gate would RED on a synthetic recall import (self-check, not on real files)", () => {
    // Prove the detector actually fires — defends against a gate that passes
    // because its matchers are broken. These synthetic sources are NEVER on disk.
    const barrelRouted = `import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge.js";`;
    const recallRepo = `import { foo } from "@vex-agent/db/repos/knowledge/recall.js";`;
    const toolModule = `import { handleLongMemorySearch } from "@vex-agent/tools/internal/long-memory/search.js";`;
    const retrievalPolicy = `import { blendAndRank } from "@vex-agent/memory/long-memory-retrieval-policy.js";`;
    const aliasedSymbol = `import { recallLongMemoryTopK as recall } from "@vex-agent/db/repos/knowledge.js";`;

    const scan = (src: string): Violation[] => {
      const out: Violation[] = [];
      for (const stmt of extractImportStatements(src)) {
        const oneLine = stmt.replace(/\s+/g, " ").trim();
        for (const re of BANNED_MODULE_SPECIFIERS) {
          if (re.test(stmt)) out.push({ file: "synthetic", importLine: oneLine, reason: re.source });
        }
        const braceMatch = stmt.match(/\{([\s\S]*?)\}/);
        const named = (braceMatch ? braceMatch[1] : "")
          .split(",")
          .map((s) => s.replace(/\btype\b/, "").trim())
          .map((s) => s.split(/\s+as\s+/)[0]!.trim())
          .filter(Boolean);
        for (const sym of BANNED_SYMBOLS) {
          if (named.includes(sym)) out.push({ file: "synthetic", importLine: oneLine, reason: sym });
        }
      }
      return out;
    };

    expect(scan(barrelRouted).length).toBeGreaterThan(0);
    expect(scan(recallRepo).length).toBeGreaterThan(0);
    expect(scan(toolModule).length).toBeGreaterThan(0);
    expect(scan(retrievalPolicy).length).toBeGreaterThan(0);
    expect(scan(aliasedSymbol).length).toBeGreaterThan(0);

    // And it does NOT fire on a LEGITIMATE knowledge type / hot-context import —
    // the gate must not blanket-ban all knowledge access (Lead Dev scoping).
    const legitTypes = `import type { KnowledgeEntry } from "@vex-agent/db/repos/knowledge.js";`;
    const legitHotContext = `import { listActiveForHotContext } from "@vex-agent/db/repos/knowledge.js";`;
    const legitSourcePolicy = `import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";`;
    expect(scan(legitTypes)).toEqual([]);
    expect(scan(legitHotContext)).toEqual([]);
    expect(scan(legitSourcePolicy)).toEqual([]);
  });
});
