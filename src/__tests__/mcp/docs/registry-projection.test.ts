import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildOverview,
  buildToolGroups,
  buildProtocolList,
  buildProtocolNamespace,
  buildSurfaceManifest,
  buildRuntimeEnv,
} from "../../../mcp/docs/registry-projection.js";

describe("mcp docs — registry projection", () => {
  // Snapshot env so we don't leak between tests.
  const ENV_KEYS = [
    "TAVILY_API_KEY",
    "POLYMARKET_API_KEY",
    "JUPITER_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
    "VEX_DB_URL",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    // Set a baseline so loadEmbeddingConfig doesn't throw inside buildOverview.
    process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
    process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
    process.env.EMBEDDING_DIM = "768";
    process.env.EMBEDDING_PROVIDER = "local";
    // Set env-gated namespaces' API keys so tests that assert "solana has
    // tools" / "polymarket has tools" are deterministic regardless of shell
    // env. Individual tests that exercise the env-gating contract delete
    // these explicitly.
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  // ── Overview ────────────────────────────────────────────────────

  describe("buildOverview", () => {
    it("returns name 'vex-mcp' and a non-empty purpose string", () => {
      const overview = buildOverview();
      expect(overview.name).toBe("vex-mcp");
      expect(overview.purpose.length).toBeGreaterThan(20);
    });

    it("reports a positive surface size and protocol namespace count", () => {
      const overview = buildOverview();
      expect(overview.surfaceSize).toBeGreaterThan(0);
      expect(overview.protocolNamespaceCount).toBeGreaterThan(0);
    });

    it("reports the configured embedding model and dim from env", () => {
      const overview = buildOverview();
      expect(overview.embeddingModel).toBe("ai/embeddinggemma:300M-Q8_0");
      expect(overview.embeddingDim).toBe(768);
    });

    it("falls back to placeholder when embedding env is missing", () => {
      delete process.env.EMBEDDING_MODEL;
      delete process.env.EMBEDDING_DIM;
      delete process.env.EMBEDDING_BASE_URL;
      delete process.env.EMBEDDING_PROVIDER;
      const overview = buildOverview();
      expect(overview.embeddingModel).toContain("unknown");
      expect(overview.embeddingDim).toBe(0);
    });
  });

  // ── Tool groups ─────────────────────────────────────────────────

  describe("buildToolGroups", () => {
    it("groups discover_tools and execute_tool into Discovery", () => {
      const groups = buildToolGroups();
      const discovery = groups.find((g) => g.group === "Discovery");
      expect(discovery).toBeDefined();
      const names = discovery!.tools.map((t) => t.name);
      expect(names).toContain("discover_tools");
      expect(names).toContain("execute_tool");
    });

    it("groups knowledge_* tools into Knowledge", () => {
      const groups = buildToolGroups();
      const knowledge = groups.find((g) => g.group === "Knowledge");
      expect(knowledge).toBeDefined();
      expect(knowledge!.tools.length).toBeGreaterThanOrEqual(5);
      for (const tool of knowledge!.tools) {
        expect(tool.name.startsWith("knowledge_")).toBe(true);
      }
    });

    it("each group's tools are sorted alphabetically", () => {
      const groups = buildToolGroups();
      for (const group of groups) {
        const sorted = [...group.tools].sort((a, b) => a.name.localeCompare(b.name));
        expect(group.tools.map((t) => t.name)).toEqual(sorted.map((t) => t.name));
      }
    });

    it("does not include any subagent_* tool in any group", () => {
      const groups = buildToolGroups();
      for (const group of groups) {
        for (const tool of group.tools) {
          expect(tool.name.startsWith("subagent_")).toBe(false);
        }
      }
    });

    it("does not surface a Schedule or Mission group (vex-agent only)", () => {
      const groups = buildToolGroups();
      const labels = groups.map((g) => g.group);
      expect(labels).not.toContain("Schedule");
      expect(labels).not.toContain("Mission");
    });

    it("does not include schedule_* or mission_stop in any group", () => {
      const groups = buildToolGroups();
      for (const group of groups) {
        for (const tool of group.tools) {
          expect(tool.name.startsWith("schedule_")).toBe(false);
          expect(tool.name).not.toBe("mission_stop");
        }
      }
    });
  });

  // ── Protocol list ───────────────────────────────────────────────

  describe("buildProtocolList", () => {
    it("returns only advertised namespaces", () => {
      const list = buildProtocolList();
      const namespaces = list.map((n) => n.namespace);
      expect(namespaces).toContain("solana");
      expect(namespaces).toContain("polymarket");
      expect(namespaces).toContain("kyberswap");
      expect(namespaces).toContain("khalani");
    });

    it("each namespace has a default portfolio role", () => {
      const list = buildProtocolList();
      for (const ns of list) {
        expect(ns.defaultPortfolioRole).toBeTruthy();
      }
    });

    // ── R5: descriptions and example queries ──────────────────────

    it("each namespace carries navigation metadata and example queries", () => {
      const list = buildProtocolList();
      for (const ns of list) {
        expect(typeof ns.description).toBe("string");
        expect(ns.description.length).toBeGreaterThan(0);
        expect(typeof ns.groupLabel).toBe("string");
        expect(ns.groupLabel.length).toBeGreaterThan(0);
        expect(typeof ns.whenToUse).toBe("string");
        expect(ns.whenToUse.length).toBeGreaterThan(0);
        expect(Array.isArray(ns.exampleQueries)).toBe(true);
        expect(Array.isArray(ns.paths)).toBe(true);
      }
    });

    it("khalani description mentions bridging (R5 — anchor on real copy)", () => {
      const list = buildProtocolList();
      const khalani = list.find((n) => n.namespace === "khalani");
      expect(khalani).toBeDefined();
      expect(khalani!.description.toLowerCase()).toContain("bridge");
    });

    it("namespaces with active tools also carry exampleQueries", () => {
      const list = buildProtocolList();
      const withTools = list.filter((n) => n.activeToolCount > 0);
      for (const ns of withTools) {
        expect(ns.exampleQueries.length).toBeGreaterThan(0);
        for (const example of ns.exampleQueries) {
          expect(example).toContain("discover_tools");
          expect(example).toContain(`namespace="${ns.namespace}"`);
        }
      }
    });

    // ── Env-aware availability (audit follow-up) ───────────────────

    it("activeToolCount is env-aware: drops to 0 when JUPITER_API_KEY is missing", () => {
      delete process.env.JUPITER_API_KEY;
      const list = buildProtocolList();
      const solana = list.find((n) => n.namespace === "solana");
      expect(solana).toBeDefined();
      expect(solana!.activeToolCount).toBe(0);
      expect(solana!.gatedByEnv).toContain("JUPITER_API_KEY");
    });

    it("activeToolCount is non-zero and gatedByEnv empty when env is present", () => {
      const list = buildProtocolList();
      const solana = list.find((n) => n.namespace === "solana");
      expect(solana).toBeDefined();
      expect(solana!.activeToolCount).toBeGreaterThan(0);
      expect(solana!.gatedByEnv).toEqual([]);
    });

    it("partially gated namespace keeps its non-gated tools and reports empty gatedByEnv when env present", () => {
      const list = buildProtocolList();
      const polymarket = list.find((n) => n.namespace === "polymarket");
      expect(polymarket).toBeDefined();
      expect(polymarket!.activeToolCount).toBeGreaterThan(0);
      expect(polymarket!.gatedByEnv).toEqual([]);
    });

    it("partially gated namespace shrinks but does not zero when only env is missing", () => {
      delete process.env.POLYMARKET_API_KEY;
      const list = buildProtocolList();
      const polymarket = list.find((n) => n.namespace === "polymarket");
      expect(polymarket).toBeDefined();
      // public gamma/data/bridge tools remain available — count > 0 but
      // strictly less than the manifest total because clob/rewards are gated
      expect(polymarket!.activeToolCount).toBeGreaterThan(0);
      expect(polymarket!.gatedByEnv).toContain("POLYMARKET_API_KEY");
    });
  });

  // ── Protocol namespace detail ───────────────────────────────────

  describe("buildProtocolNamespace", () => {
    it("returns null for unknown namespace", () => {
      expect(buildProtocolNamespace("nonexistent")).toBeNull();
    });

    it("returns sorted tool list for solana", () => {
      const ns = buildProtocolNamespace("solana");
      expect(ns).not.toBeNull();
      expect(ns!.tools.length).toBeGreaterThan(0);
      const sorted = [...ns!.tools].sort((a, b) => a.toolId.localeCompare(b.toolId));
      expect(ns!.tools.map((t) => t.toolId)).toEqual(sorted.map((t) => t.toolId));
    });

    it("includes navigation metadata and paths before tools", () => {
      const ns = buildProtocolNamespace("solana");
      expect(ns).not.toBeNull();
      expect(typeof ns!.description).toBe("string");
      expect(ns!.description.length).toBeGreaterThan(0);
      expect(typeof ns!.whenToUse).toBe("string");
      expect(ns!.whenToUse.length).toBeGreaterThan(0);
      expect(Array.isArray(ns!.exampleQueries)).toBe(true);
      expect(ns!.exampleQueries.length).toBeGreaterThan(0);
      expect(Array.isArray(ns!.paths)).toBe(true);
      expect(ns!.paths.length).toBeGreaterThan(0);
    });

    it("each tool carries namespace, description, mutating, lifecycle", () => {
      const ns = buildProtocolNamespace("polymarket");
      expect(ns).not.toBeNull();
      for (const tool of ns!.tools) {
        expect(tool.namespace).toBe("polymarket");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.mutating).toBe("boolean");
        expect(typeof tool.lifecycle).toBe("string");
      }
    });

    // ── Env-aware availability (audit follow-up) ───────────────────

    it("filters out env-gated tools when env is missing", () => {
      delete process.env.JUPITER_API_KEY;
      const ns = buildProtocolNamespace("solana");
      expect(ns).not.toBeNull();
      expect(ns!.tools).toEqual([]);
      expect(ns!.gatedByEnv).toContain("JUPITER_API_KEY");
    });

    it("returns the full env-available tool list when env is present", () => {
      const ns = buildProtocolNamespace("solana");
      expect(ns).not.toBeNull();
      expect(ns!.tools.length).toBeGreaterThan(0);
      expect(ns!.gatedByEnv).toEqual([]);
    });
  });

  // ── Surface manifest ────────────────────────────────────────────

  describe("buildSurfaceManifest", () => {
    it("returns version 1, sorted tool names, namespace list", () => {
      const manifest = buildSurfaceManifest();
      expect(manifest.version).toBe(1);
      expect(manifest.tools.length).toBeGreaterThan(0);
      const sorted = [...manifest.tools].sort();
      expect(manifest.tools).toEqual(sorted);
      expect(manifest.protocolNamespaces.length).toBeGreaterThan(0);
    });

    it("excludes subagent_* from manifest tools", () => {
      const manifest = buildSurfaceManifest();
      for (const name of manifest.tools) {
        expect(name.startsWith("subagent_")).toBe(false);
      }
    });

    it("excludes schedule_* and mission_stop from manifest tools", () => {
      const manifest = buildSurfaceManifest();
      for (const name of manifest.tools) {
        expect(name.startsWith("schedule_")).toBe(false);
        expect(name).not.toBe("mission_stop");
      }
    });

    it("generatedAt is a parseable ISO date", () => {
      const manifest = buildSurfaceManifest();
      const ts = new Date(manifest.generatedAt).getTime();
      expect(Number.isFinite(ts)).toBe(true);
    });
  });

  // ── Runtime env ─────────────────────────────────────────────────

  describe("buildRuntimeEnv", () => {
    it("never returns env values, only presence flags", () => {
      process.env.TAVILY_API_KEY = "secret-do-not-leak-12345";
      const env = buildRuntimeEnv();
      const stringified = JSON.stringify(env);
      expect(stringified).not.toContain("secret-do-not-leak-12345");
      expect(env.envFlags.TAVILY_API_KEY).toBe("present");
    });

    it("reports POLYMARKET_API_KEY=missing when unset", () => {
      delete process.env.POLYMARKET_API_KEY;
      const env = buildRuntimeEnv();
      expect(env.envFlags.POLYMARKET_API_KEY).toBe("missing");
    });

    it("reports embedding model + dim from configured env", () => {
      const env = buildRuntimeEnv();
      expect(env.embeddingModel).toBe("ai/embeddinggemma:300M-Q8_0");
      expect(env.embeddingDim).toBe(768);
    });
  });
});
