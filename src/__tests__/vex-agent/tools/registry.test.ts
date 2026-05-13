import { describe, it, expect } from "vitest";
import {
  getToolDef,
  isInternalTool,
  isMutatingTool,
  getAllTools,
  getOpenAITools,
  getProductionMcpTools,
  isToolBlockedForRole,
  defaultVisibilityContext,
} from "../../../vex-agent/tools/registry.js";

describe("registry", () => {
  // ── Tool lookup ──────────────────────────────────────────────────

  it("returns all registered tools", () => {
    const tools = getAllTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("finds tool by name", () => {
    const tool = getToolDef("discover_tools");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("discover_tools");
    expect(tool!.kind).toBe("internal");
  });

  it("returns undefined for unknown tool", () => {
    expect(getToolDef("nonexistent_tool")).toBeUndefined();
  });

  // ── Classification ───────────────────────────────────────────────

  it("classifies all registered tools as internal", () => {
    const tools = getAllTools();
    for (const tool of tools) {
      expect(isInternalTool(tool.name)).toBe(true);
    }
  });

  it("returns false for unknown tool in isInternalTool", () => {
    expect(isInternalTool("fake_tool")).toBe(false);
  });

  it("identifies wallet_send_confirm as mutating", () => {
    expect(isMutatingTool("wallet_send_confirm")).toBe(true);
  });

  it("identifies discover_tools as non-mutating", () => {
    expect(isMutatingTool("discover_tools")).toBe(false);
  });

  it("identifies web_research as non-mutating", () => {
    expect(isMutatingTool("web_research")).toBe(false);
  });

  it("identifies twitter_account as non-mutating", () => {
    expect(isMutatingTool("twitter_account")).toBe(false);
  });

  // ── Expected tools present ───────────────────────────────────────

  const EXPECTED_TOOLS = [
    "discover_tools",
    "execute_tool",
    "web_research",
    "twitter_account",
    "document_read",
    "document_write",
    "document_list",
    "document_delete",
    "knowledge_write",
    "knowledge_recall",
    "knowledge_recall_overflow",
    "knowledge_get",
    "knowledge_update_status",
    "knowledge_supersede",
    "knowledge_lineage",
    "knowledge_history",
    // TODO(subagent-disabled): przywrócić gdy subagent runtime wraca.
    // "subagent_spawn",
    // "subagent_status",
    // "subagent_stop",
    // "subagent_reply",
    // "subagent_request_parent",
    // "subagent_report_complete",
    "wallet_read",
    "wallet_send_prepare",
    "wallet_send_confirm",
    "khalani_chains_list",
    "khalani_tokens_top",
    "khalani_tokens_search",
    "khalani_tokens_balances",
    "mission_draft_update",
  ];

  for (const name of EXPECTED_TOOLS) {
    it(`has tool: ${name}`, () => {
      expect(getToolDef(name)).toBeDefined();
    });
  }

  // ── Removed tools NOT present ────────────────────────────────────

  it("does NOT have trade_log (auto-capture replaces it)", () => {
    expect(getToolDef("trade_log")).toBeUndefined();
  });

  it("does NOT have memory_update (deprecated)", () => {
    expect(getToolDef("memory_update")).toBeUndefined();
  });

  it("does NOT have memory_manage (replaced by knowledge_*)", () => {
    expect(getToolDef("memory_manage")).toBeUndefined();
  });

  it("does NOT have wallet_backup (deferred)", () => {
    expect(getToolDef("wallet_backup")).toBeUndefined();
  });

  // ── OpenAI format ────────────────────────────────────────────────

  it("converts tools to OpenAI format", () => {
    const openaiTools = getOpenAITools(defaultVisibilityContext());
    expect(openaiTools.length).toBeGreaterThan(0);

    for (const tool of openaiTools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("filters proactive tools in restricted permission", () => {
    const restrictedTools = getOpenAITools(defaultVisibilityContext({ permission: "restricted" }));
    const fullTools = getOpenAITools(defaultVisibilityContext({ permission: "full" }));
    expect(restrictedTools.length).toBeLessThanOrEqual(fullTools.length);
  });

  // ── Tool definitions quality ─────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of getAllTools()) {
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("every tool has valid parameters schema", () => {
    for (const tool of getAllTools()) {
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.parameters.properties).toBe("object");
    }
  });

  it("discover_tools namespace description is generated from advertised namespaces", () => {
    const discover = getToolDef("discover_tools");
    const namespace = discover?.parameters.properties?.namespace;
    expect(namespace).toBeDefined();
    expect(namespace?.description).toContain("dexscreener");
    expect(namespace?.description).toContain("polymarket");
    expect(namespace?.description).toContain("khalani");
  });

  it("mutating tools are wallet_send_confirm, polymarket_setup, checkpoint_handoff_prepare", () => {
    const mutating = getAllTools().filter(t => t.mutating).map(t => t.name).sort();
    expect(mutating).toEqual([
      "checkpoint_handoff_prepare",
      "polymarket_setup",
      "wallet_send_confirm",
    ]);
  });

  // ── Role filtering ──────────────────────────────────────────────

  describe("role filtering", () => {
    it("subagent role excludes mission_stop, subagent_spawn, subagent_reply", () => {
      const tools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "subagent" }));
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("mission_stop");
      expect(names).not.toContain("subagent_spawn");
      expect(names).not.toContain("subagent_reply");
    });

    // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS.
    it.skip("subagent role includes subagent_request_parent and subagent_report_complete", () => {
      const tools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "subagent" }));
      const names = tools.map(t => t.function.name);
      expect(names).toContain("subagent_request_parent");
      expect(names).toContain("subagent_report_complete");
    });

    it("parent role excludes subagent_request_parent and subagent_report_complete", () => {
      const tools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "parent" }));
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("subagent_request_parent");
      expect(names).not.toContain("subagent_report_complete");
    });

    // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS.
    it.skip("parent role includes mission_stop (inside a run), subagent_spawn, subagent_reply", () => {
      const tools = getOpenAITools(defaultVisibilityContext({
        permission: "restricted",
        role: "parent",
        // mission_stop is now hiddenInAgent — check it inside an active mission run
        sessionKind: "mission",
        missionRunActive: true,
      }));
      const names = tools.map(t => t.function.name);
      expect(names).toContain("mission_stop");
      expect(names).toContain("subagent_spawn");
      expect(names).toContain("subagent_reply");
    });

    it("mission_stop is hidden in agent sessions (hiddenInAgent visibility gate)", () => {
      const tools = getOpenAITools(defaultVisibilityContext({
        permission: "restricted",
        role: "parent",
        sessionKind: "agent",
      }));
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("mission_stop");
    });

    it("mission tools split setup and run surfaces", () => {
      const setupNames = getOpenAITools(defaultVisibilityContext({
        permission: "restricted",
        role: "parent",
        sessionKind: "mission",
        missionRunActive: false,
      })).map(t => t.function.name);
      expect(setupNames).toContain("mission_draft_update");
      expect(setupNames).not.toContain("mission_stop");

      const runNames = getOpenAITools(defaultVisibilityContext({
        permission: "restricted",
        role: "parent",
        sessionKind: "mission",
        missionRunActive: true,
      })).map(t => t.function.name);
      expect(runNames).toContain("mission_stop");
      expect(runNames).not.toContain("mission_draft_update");
    });

    it("subagent_status and subagent_stop are excluded for subagent role", () => {
      const tools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "subagent" }));
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("subagent_status");
      expect(names).not.toContain("subagent_stop");
    });

    // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS.
    it.skip("subagent_status and subagent_stop remain visible to parent role", () => {
      const tools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "parent" }));
      const names = tools.map(t => t.function.name);
      expect(names).toContain("subagent_status");
      expect(names).toContain("subagent_stop");
    });

    // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS.
    it.skip("isToolBlockedForRole returns true for blocked tools", () => {
      expect(isToolBlockedForRole("mission_stop", "subagent")).toBe(true);
      expect(isToolBlockedForRole("subagent_request_parent", "parent")).toBe(true);
    });

    it("isToolBlockedForRole returns false for allowed tools", () => {
      expect(isToolBlockedForRole("mission_stop", "parent")).toBe(false);
      expect(isToolBlockedForRole("subagent_request_parent", "subagent")).toBe(false);
      expect(isToolBlockedForRole("web_research", "subagent")).toBe(false);
    });

    it("defaultVisibilityContext produces parent-role defaults", () => {
      const defaultTools = getOpenAITools(defaultVisibilityContext({ permission: "restricted" }));
      const parentTools = getOpenAITools(defaultVisibilityContext({ permission: "restricted", role: "parent" }));
      expect(defaultTools.length).toBe(parentTools.length);
    });
  });

  // ── Production MCP surface ───────────────────────────────────────

  describe("getProductionMcpTools", () => {
    it("includes the core host-relevant tools", () => {
      const names = getProductionMcpTools().map((t) => t.name);
      expect(names).toContain("discover_tools");
      expect(names).toContain("execute_tool");
      expect(names).toContain("wallet_read");
      expect(names).toContain("khalani_tokens_balances");
      expect(names).toContain("wallet_send_prepare");
      expect(names).toContain("wallet_send_confirm");
      expect(names).toContain("knowledge_write");
      expect(names).toContain("knowledge_lineage");
      expect(names).toContain("knowledge_history");
      expect(names).toContain("portfolio_inspect");
    });

    // Single-tool exclusion test for `mission_stop`. The full agent-only freeze
    // for `loop_defer`, `checkpoint_handoff_prepare`, `tool_output_read` lives in
    // `__tests__/mcp/docs/no-autonomy-leak.test.ts` (broader: also gates docs/manifest).
    it("excludes mission_stop (vex-agent runtime concept)", () => {
      const names = getProductionMcpTools().map((t) => t.name);
      expect(names).not.toContain("mission_stop");
    });

    it("excludes every subagent_* tool", () => {
      const names = getProductionMcpTools().map((t) => t.name);
      for (const name of names) {
        expect(name.startsWith("subagent_")).toBe(false);
      }
    });

    it("mission_stop remains visible to Vex Agent inside an active mission run", () => {
      const names = getOpenAITools(defaultVisibilityContext({
        permission: "restricted",
        role: "parent",
        sessionKind: "mission",
        missionRunActive: true,
      })).map((t) => t.function.name);
      expect(names).toContain("mission_stop");
    });

    // ── surface: "mcp" — self-doc tools hidden from agent ──────────

    it("excludes vex_introduction from agent surface (already covered by system prompt)", () => {
      const names = getOpenAITools(defaultVisibilityContext()).map((t) => t.function.name);
      expect(names).not.toContain("vex_introduction");
    });

    it("excludes vex_namespace_tools from agent surface (already covered by system prompt)", () => {
      const names = getOpenAITools(defaultVisibilityContext()).map((t) => t.function.name);
      expect(names).not.toContain("vex_namespace_tools");
    });

    it("includes vex_introduction in MCP surface (host orientation)", () => {
      const names = getProductionMcpTools().map((t) => t.name);
      expect(names).toContain("vex_introduction");
    });

    it("includes vex_namespace_tools in MCP surface (host orientation)", () => {
      const names = getProductionMcpTools().map((t) => t.name);
      expect(names).toContain("vex_namespace_tools");
    });
  });
});
