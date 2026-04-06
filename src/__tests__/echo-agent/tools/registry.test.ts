import { describe, it, expect } from "vitest";
import {
  getToolDef,
  isInternalTool,
  isMutatingTool,
  getAllTools,
  getOpenAITools,
  isToolBlockedForRole,
} from "../../../echo-agent/tools/registry.js";

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

  it("identifies web_search as non-mutating", () => {
    expect(isMutatingTool("web_search")).toBe(false);
  });

  // ── Expected tools present ───────────────────────────────────────

  const EXPECTED_TOOLS = [
    "discover_tools",
    "execute_tool",
    "web_search",
    "web_fetch",
    "document_read",
    "document_write",
    "document_list",
    "document_delete",
    "knowledge_write",
    "knowledge_recall",
    "knowledge_recall_overflow",
    "knowledge_get",
    "knowledge_update_status",
    "schedule_create",
    "schedule_remove",
    "subagent_spawn",
    "subagent_status",
    "subagent_stop",
    "subagent_reply",
    "subagent_request_parent",
    "subagent_report_complete",
    "wallet_read",
    "wallet_send_prepare",
    "wallet_send_confirm",
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
    const openaiTools = getOpenAITools();
    expect(openaiTools.length).toBeGreaterThan(0);

    for (const tool of openaiTools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters.type).toBe("object");
    }
  });

  it("filters proactive tools in off mode", () => {
    const offTools = getOpenAITools("off");
    const fullTools = getOpenAITools("full");
    expect(offTools.length).toBeLessThanOrEqual(fullTools.length);
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

  it("mutating tools are wallet_send_confirm and polymarket_setup", () => {
    const mutating = getAllTools().filter(t => t.mutating).map(t => t.name).sort();
    expect(mutating).toEqual(["polymarket_setup", "wallet_send_confirm"]);
  });

  // ── Role filtering ──────────────────────────────────────────────

  describe("role filtering", () => {
    it("subagent role excludes mission_stop, subagent_spawn, subagent_reply", () => {
      const tools = getOpenAITools("restricted", "subagent");
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("mission_stop");
      expect(names).not.toContain("subagent_spawn");
      expect(names).not.toContain("subagent_reply");
    });

    it("subagent role includes subagent_request_parent and subagent_report_complete", () => {
      const tools = getOpenAITools("restricted", "subagent");
      const names = tools.map(t => t.function.name);
      expect(names).toContain("subagent_request_parent");
      expect(names).toContain("subagent_report_complete");
    });

    it("parent role excludes subagent_request_parent and subagent_report_complete", () => {
      const tools = getOpenAITools("restricted", "parent");
      const names = tools.map(t => t.function.name);
      expect(names).not.toContain("subagent_request_parent");
      expect(names).not.toContain("subagent_report_complete");
    });

    it("parent role includes mission_stop, subagent_spawn, subagent_reply", () => {
      const tools = getOpenAITools("restricted", "parent");
      const names = tools.map(t => t.function.name);
      expect(names).toContain("mission_stop");
      expect(names).toContain("subagent_spawn");
      expect(names).toContain("subagent_reply");
    });

    it("isToolBlockedForRole returns true for blocked tools", () => {
      expect(isToolBlockedForRole("mission_stop", "subagent")).toBe(true);
      expect(isToolBlockedForRole("subagent_request_parent", "parent")).toBe(true);
    });

    it("isToolBlockedForRole returns false for allowed tools", () => {
      expect(isToolBlockedForRole("mission_stop", "parent")).toBe(false);
      expect(isToolBlockedForRole("subagent_request_parent", "subagent")).toBe(false);
      expect(isToolBlockedForRole("web_search", "subagent")).toBe(false);
    });

    it("default role is parent", () => {
      const defaultTools = getOpenAITools("restricted");
      const parentTools = getOpenAITools("restricted", "parent");
      expect(defaultTools.length).toBe(parentTools.length);
    });
  });
});
