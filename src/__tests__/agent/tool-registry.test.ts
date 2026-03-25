import { describe, it, expect } from "vitest";
import {
  TOOLS,
  getToolDef,
  isInternal,
  isMutating,
  supportsYes,
  toOpenAITools,
} from "../../agent/tool-registry.js";

describe("TOOLS registry", () => {
  it("contains at least the 14 internal tools", () => {
    const internal = TOOLS.filter(t => t.kind === "internal");
    expect(internal.length).toBeGreaterThanOrEqual(14);
  });

  it("every tool has required fields", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(["internal", "cli"]).toContain(tool.kind);
      expect(typeof tool.mutating).toBe("boolean");
    }
  });

  it("no duplicate names", () => {
    const names = TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("getToolDef", () => {
  it("returns definition for known internal tool", () => {
    const def = getToolDef("web_search");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("internal");
  });

  it("returns undefined for unknown tool", () => {
    expect(getToolDef("nonexistent_tool")).toBeUndefined();
  });
});

describe("isInternal", () => {
  it("returns true for internal tools", () => {
    expect(isInternal("file_read")).toBe(true);
    expect(isInternal("memory_manage")).toBe(true);
    expect(isInternal("subagent_spawn")).toBe(true);
  });

  it("returns false for unknown tool", () => {
    expect(isInternal("unknown")).toBe(false);
  });
});

describe("isMutating", () => {
  it("returns false for internal tools (none are mutating)", () => {
    const internal = TOOLS.filter(t => t.kind === "internal");
    for (const tool of internal) {
      expect(isMutating(tool.name)).toBe(false);
    }
  });

  it("returns false for unknown tool", () => {
    expect(isMutating("unknown")).toBe(false);
  });
});

describe("supportsYes", () => {
  it("returns true for solana_swap_execute", () => {
    expect(supportsYes("solana_swap_execute")).toBe(true);
  });

  it("returns true for khalani_bridge", () => {
    expect(supportsYes("khalani_bridge")).toBe(true);
  });

  it("returns true for polymarket_buy", () => {
    expect(supportsYes("polymarket_buy")).toBe(true);
  });

  it("returns false for web_search", () => {
    expect(supportsYes("web_search")).toBe(false);
  });

  it("returns false for unknown command", () => {
    expect(supportsYes("unknown_command")).toBe(false);
  });
});

describe("toOpenAITools", () => {
  it("returns all tools when chatMode is 'full'", () => {
    const tools = toOpenAITools("full");
    expect(tools.length).toBe(TOOLS.length);
  });

  it("returns all tools when chatMode is 'restricted'", () => {
    const tools = toOpenAITools("restricted");
    expect(tools.length).toBe(TOOLS.length);
  });

  it("filters proactive tools when chatMode is 'off'", () => {
    const allTools = toOpenAITools("full");
    const manualTools = toOpenAITools("off");
    const proactiveCount = TOOLS.filter(t => t.proactive).length;
    expect(manualTools.length).toBe(allTools.length - proactiveCount);
  });

  it("all returned tools have OpenAI format", () => {
    const tools = toOpenAITools("full");
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters).toBeDefined();
    }
  });

  it("defaults to 'off' when no mode specified", () => {
    const tools = toOpenAITools();
    const manualTools = toOpenAITools("off");
    expect(tools.length).toBe(manualTools.length);
  });
});
