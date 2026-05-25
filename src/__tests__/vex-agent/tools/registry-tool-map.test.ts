/**
 * Tool Map integrity — every agent-surface ToolDef must appear in exactly
 * one `TOOL_MAP_CATEGORIES` entry, every name in the map must resolve to
 * a registered ToolDef, and MCP-only / dormant-subagent tools must NOT
 * appear in the agent Tool Map.
 *
 * Codex PR3 plan-review (round 1) required this scoping: the invariant
 * covers tools the LLM in agent runtime will see, not the union of every
 * tool in the repo. `vex_introduction` / `vex_namespace_tools` are
 * `surface: "mcp"` (filtered out by `getOpenAITools`), and the
 * `SUBAGENT_TOOLS` array is currently `[]` per the dormant-subagent
 * comment in `registry/subagents.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  TOOL_MAP_CATEGORIES,
  getAllTools,
  getToolDef,
} from "../../../vex-agent/tools/registry.js";

const AGENT_SURFACE_TOOL_NAMES = getAllTools()
  .filter(t => t.surface !== "mcp")
  // Subagent dormancy: SUBAGENT_TOOLS is `[]` today. If re-enabled,
  // re-evaluate whether subagent_* belong in the agent Tool Map.
  .filter(t => !t.name.startsWith("subagent_"))
  .map(t => t.name);

const TOOL_MAP_NAMES = TOOL_MAP_CATEGORIES.flatMap(c => c.toolNames);

describe("TOOL_MAP_CATEGORIES integrity", () => {
  it("every agent-surface tool appears in exactly one category", () => {
    const orphans: string[] = [];
    for (const name of AGENT_SURFACE_TOOL_NAMES) {
      const occurrences = TOOL_MAP_NAMES.filter(n => n === name).length;
      if (occurrences !== 1) {
        orphans.push(`${name} (appears ${occurrences}× in TOOL_MAP_CATEGORIES)`);
      }
    }
    expect(orphans, `agent-surface tools NOT singly-categorized: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every name in TOOL_MAP_CATEGORIES resolves to a registered ToolDef (no typos)", () => {
    const unresolved: string[] = [];
    for (const cat of TOOL_MAP_CATEGORIES) {
      for (const name of cat.toolNames) {
        if (!getToolDef(name)) {
          unresolved.push(`${name} (in category "${cat.label}")`);
        }
      }
    }
    expect(unresolved, `TOOL_MAP_CATEGORIES names not found in registry: ${unresolved.join(", ")}`).toEqual([]);
  });

  it("MCP-only orientation tools are NOT in any agent Tool Map category", () => {
    // `vex_introduction` / `vex_namespace_tools` are declared
    // `surface: "mcp"` in registry/vex.ts so they reach the MCP host but
    // never the agent runtime. They must not appear in any category here.
    expect(TOOL_MAP_NAMES).not.toContain("vex_introduction");
    expect(TOOL_MAP_NAMES).not.toContain("vex_namespace_tools");
  });

  it("does NOT include dormant subagent_* tools", () => {
    // If SUBAGENT_TOOLS is re-enabled, this assertion has to be revisited
    // (add a "Subagent control" category, decide whether subagent_* are
    // model-facing or operator-only).
    const subagentLeaks = TOOL_MAP_NAMES.filter(n => n.startsWith("subagent_"));
    expect(subagentLeaks).toEqual([]);
  });

  it("renders in declared order — no alphabetical sort within categories", () => {
    // Codex PR3 GREEN-LIGHT note (2): "Do not enforce alphabetical order
    // inside categories." Order carries model-priority intent (reads
    // before writes within Wallet, discover before execute within
    // Protocol meta-tools, etc).
    const wallet = TOOL_MAP_CATEGORIES.find(c => c.label === "Wallet transfers");
    expect(wallet?.toolNames).toEqual(["wallet_send_prepare", "wallet_send_confirm"]);
    // "prepare" before "confirm" is the 2-step transfer contract; if a
    // future refactor sorted alphabetically, "confirm" would come first
    // and lose the workflow signal.

    const protocolMeta = TOOL_MAP_CATEGORIES.find(c => c.label === "Protocol discovery/execution");
    expect(protocolMeta?.toolNames).toEqual(["discover_tools", "execute_tool"]);
  });
});
