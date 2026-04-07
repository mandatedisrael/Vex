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
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
    "ECHO_AGENT_DB_URL",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    // Set a baseline so loadEmbeddingConfig doesn't throw inside buildOverview.
    process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
    process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
    process.env.EMBEDDING_DIM = "768";
    process.env.EMBEDDING_PROVIDER = "local";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  // ── Overview ────────────────────────────────────────────────────

  describe("buildOverview", () => {
    it("returns name 'echoclaw-mcp' and a non-empty purpose string", () => {
      const overview = buildOverview();
      expect(overview.name).toBe("echoclaw-mcp");
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
  });

  // ── Protocol list ───────────────────────────────────────────────

  describe("buildProtocolList", () => {
    it("returns the full namespace allowlist", () => {
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

    it("each namespace carries a non-empty description and an exampleQueries array", () => {
      const list = buildProtocolList();
      for (const ns of list) {
        expect(typeof ns.description).toBe("string");
        expect(ns.description.length).toBeGreaterThan(0);
        expect(Array.isArray(ns.exampleQueries)).toBe(true);
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
      // 0g-compute / 0g-storage are intentionally excluded — no active tools yet.
      const withTools = list.filter((n) => n.activeToolCount > 0);
      for (const ns of withTools) {
        expect(ns.exampleQueries.length).toBeGreaterThan(0);
        for (const example of ns.exampleQueries) {
          expect(example).toContain("discover_tools");
          expect(example).toContain(`namespace="${ns.namespace}"`);
        }
      }
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

    it("includes header description and exampleQueries before tools (R5)", () => {
      const ns = buildProtocolNamespace("solana");
      expect(ns).not.toBeNull();
      expect(typeof ns!.description).toBe("string");
      expect(ns!.description.length).toBeGreaterThan(0);
      expect(Array.isArray(ns!.exampleQueries)).toBe(true);
      expect(ns!.exampleQueries.length).toBeGreaterThan(0);
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
