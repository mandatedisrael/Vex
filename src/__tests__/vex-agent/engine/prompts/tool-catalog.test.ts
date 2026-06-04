/**
 * `buildToolCatalogPrompt` regression — Tool Map renders the right
 * categories + names for each of the 4 modes (agent / mission setup /
 * mission run / subagent) and the 4 pressure bands (normal / warning /
 * barrier / critical).
 *
 * Codex PR3 GREEN LIGHT verification: visibility-aware, empty categories
 * dropped, names in declared order across all contexts.
 */

import { describe, it, expect } from "vitest";

import { buildToolCatalogPrompt } from "../../../../vex-agent/engine/prompts/tool-catalog.js";
import type { ToolVisibilityContext } from "../../../../vex-agent/tools/registry.js";

function makeCtx(overrides: Partial<ToolVisibilityContext> = {}): ToolVisibilityContext {
  return {
    permission: "full",
    role: "parent",
    sessionKind: "agent",
    missionRunActive: false,
    contextUsageBand: "normal",
    ...overrides,
  };
}

describe("buildToolCatalogPrompt — visibility-aware Tool Map", () => {
  describe("agent chat, normal band", () => {
    it("renders all expected categories + tools", () => {
      const out = buildToolCatalogPrompt(makeCtx());

      expect(out).toContain("# Available Tool Map");

      // Reads / orientation visible
      expect(out).toContain("**Protocol discovery/execution:** discover_tools, execute_tool");
      expect(out).toContain("**Live state reads:** wallet_balances, evm_read, portfolio");

      // Memory + knowledge visible (read tools at normal band)
      expect(out).toContain("**Session memory — this conversation/mission only:** memory_recall, mark_outstanding_resolved");
      expect(out).toContain("**Knowledge recall/history — curated across sessions:** knowledge_recall,");
      expect(out).toContain("**Knowledge write/lifecycle:** knowledge_write, knowledge_supersede, knowledge_update_status");

      // Wallet transfers visible at normal band
      expect(out).toContain("**Wallet transfers:** wallet_send_prepare, wallet_send_confirm");

      // Mission-only / setup-only categories are HIDDEN in agent chat
      expect(out).not.toContain("Mission setup draft");
      expect(out).not.toContain("Mission run stop");
      expect(out).not.toContain("Mission run scheduling");

      // compact_now is hidden below barrier
      expect(out).not.toContain("Context compaction");

      // Retired orientation tools never appear in the agent map.
      expect(out).not.toContain("vex_introduction");
      expect(out).not.toContain("vex_namespace_tools");
    });
  });

  describe("agent chat, barrier band", () => {
    it("drops mutating tools and surfaces compact_now", () => {
      const out = buildToolCatalogPrompt(makeCtx({ contextUsageBand: "barrier" }));

      // compact_only emerges at barrier
      expect(out).toContain("**Context compaction — pressure only:** compact_now");

      // Mutating categories disappear
      expect(out).not.toContain("Wallet transfers");
      expect(out).not.toContain("Knowledge write/lifecycle");
      expect(out).not.toContain("Documents write");
      expect(out).not.toContain("Setup/onboarding");

      // Reads remain
      expect(out).toContain("Live state reads");
      expect(out).toContain("Knowledge recall/history");
      expect(out).toContain("Documents read");
      expect(out).toContain("Session memory");
    });
  });

  describe("mission setup, normal band", () => {
    it("includes mission_draft_update, excludes mission_stop and loop_defer", () => {
      const out = buildToolCatalogPrompt(makeCtx({
        sessionKind: "mission",
        missionRunActive: false,
      }));

      expect(out).toContain("**Mission setup draft:** mission_draft_update");
      expect(out).not.toContain("Mission run stop");
      expect(out).not.toContain("Mission run scheduling");
      // tool_output_read is hidden in mission setup
      expect(out).not.toContain("Runtime overflow recovery");
    });
  });

  describe("mission active run, normal band", () => {
    it("includes mission_stop + loop_defer, excludes mission_draft_update", () => {
      const out = buildToolCatalogPrompt(makeCtx({
        sessionKind: "mission",
        missionRunActive: true,
      }));

      expect(out).toContain("**Mission run stop:** mission_stop");
      expect(out).toContain("**Mission run scheduling:** loop_defer");
      expect(out).not.toContain("Mission setup draft");
      expect(out).toContain("**Runtime overflow recovery:** tool_output_read");
    });
  });

  describe("mission active run, critical band", () => {
    it("loop_defer disappears (pressureSafety: mutating); mission_stop remains (safe_at_barrier)", () => {
      const out = buildToolCatalogPrompt(makeCtx({
        sessionKind: "mission",
        missionRunActive: true,
        contextUsageBand: "critical",
      }));

      // mission_stop is safe_at_barrier — survives at critical
      expect(out).toContain("**Mission run stop:** mission_stop");
      // loop_defer is pressureSafety: "mutating" — gone at critical
      expect(out).not.toContain("Mission run scheduling");
      // compact_now visible
      expect(out).toContain("Context compaction");
    });
  });

  describe("subagent role", () => {
    it("excludes mission control + setup + compact_now (excluded by role)", () => {
      const out = buildToolCatalogPrompt(makeCtx({
        role: "subagent",
        sessionKind: "mission",
        missionRunActive: true,
      }));

      // All four mission/compact categories rely on `excludeRoles: ["subagent"]`
      expect(out).not.toContain("Mission setup draft");
      expect(out).not.toContain("Mission run stop");
      expect(out).not.toContain("Mission run scheduling");
      expect(out).not.toContain("Context compaction");
      expect(out).not.toContain("Setup/onboarding");
    });

    it("retains memory + knowledge + documents + reads", () => {
      const out = buildToolCatalogPrompt(makeCtx({
        role: "subagent",
        sessionKind: "mission",
        missionRunActive: true,
      }));

      expect(out).toContain("Session memory");
      expect(out).toContain("Knowledge recall/history");
      expect(out).toContain("Live state reads");
      expect(out).toContain("Documents read");
    });
  });

  describe("ordering preservation", () => {
    it("renders categories in TOOL_MAP_CATEGORIES declared order", () => {
      const out = buildToolCatalogPrompt(makeCtx());
      const lines = out.split("\n").filter(l => l.startsWith("**"));
      // First content line MUST be Protocol discovery/execution per
      // declared order — this catches an accidental alphabetical sort
      // (which would put "Khalani" or another K-label earlier).
      expect(lines[0]).toMatch(/^\*\*Protocol discovery\/execution:/);
    });

    it("preserves tool order within Wallet transfers (prepare before confirm)", () => {
      const out = buildToolCatalogPrompt(makeCtx());
      expect(out).toContain("**Wallet transfers:** wallet_send_prepare, wallet_send_confirm");
      // NOT alphabetical (confirm < prepare) — that would break the
      // 2-step transfer workflow signal codex flagged.
      expect(out).not.toContain("wallet_send_confirm, wallet_send_prepare");
    });
  });

  describe("empty-category dropping", () => {
    it("at agent normal band the Context compaction category is dropped (compact_now hidden below barrier)", () => {
      const out = buildToolCatalogPrompt(makeCtx());
      expect(out).not.toContain("Context compaction");
    });

    it("at subagent role the mission categories are all dropped", () => {
      const out = buildToolCatalogPrompt(makeCtx({ role: "subagent" }));
      expect(out).not.toContain("Mission setup");
      expect(out).not.toContain("Mission run");
    });
  });
});
