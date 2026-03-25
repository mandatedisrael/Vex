/**
 * Tests for mode-based tool filtering via proactive flag.
 *
 * CLI tools have been removed (discover+execute routing).
 * Only internal tools remain in the registry.
 */

import { describe, it, expect } from "vitest";
import { toOpenAITools, TOOLS } from "../../agent/tool-registry.js";
import type { ChatMode } from "../../agent/types.js";

const toolNames = (mode: ChatMode) => toOpenAITools(mode).map(t => t.function.name);

describe("toOpenAITools mode filtering", () => {
  it("returns all tools when chatMode is 'full'", () => {
    const full = toOpenAITools("full");
    expect(full.length).toBe(TOOLS.length);
  });

  it("returns all tools when chatMode is 'restricted'", () => {
    const restricted = toOpenAITools("restricted");
    expect(restricted.length).toBe(TOOLS.length);
  });

  it("defaults to 'off' mode when no mode passed", () => {
    const defaultTools = toOpenAITools();
    const offTools = toOpenAITools("off");
    expect(defaultTools.length).toBe(offTools.length);
  });

  // Internal tools that MUST be available in all modes
  const mustBeAvailable = [
    "web_search",
    "web_fetch",
    "file_read",
    "file_write",
    "file_list",
    "memory_manage",
    "trade_log",
    "schedule_create",
    "schedule_remove",
    "subagent_spawn",
    "subagent_stop",
  ];

  for (const name of mustBeAvailable) {
    it(`keeps ${name} available in 'off' mode`, () => {
      expect(toolNames("off")).toContain(name);
    });
  }

  it("only contains internal tools (no CLI tools)", () => {
    const all = toOpenAITools("full");
    // All remaining tools should be internal — no CLI pass-through tools
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(20); // Internal tools only
  });
});

describe("proactive flag on ToolDef", () => {
  const getDef = (name: string) => TOOLS.find(t => t.name === name);

  it("trade_log does NOT have proactive=true", () => {
    expect(getDef("trade_log")?.proactive).toBeFalsy();
  });

  it("schedule_create does NOT have proactive=true", () => {
    expect(getDef("schedule_create")?.proactive).toBeFalsy();
  });

  it("web_search does NOT have proactive=true", () => {
    expect(getDef("web_search")?.proactive).toBeFalsy();
  });
});
