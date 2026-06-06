/**
 * Façade-surface guard for the registry structural split (A-029).
 *
 * `src/vex-agent/tools/registry.ts` was split into sibling modules under
 * `./registry/` (lookup, visibility, openai-tools, tool-map) while the original
 * path stays a re-export façade. This test pins the EXACT public surface so a
 * later edit cannot silently drop, rename, or add an export. Behavior of each
 * symbol is covered by the dedicated registry-*.test.ts suites; here we only
 * assert presence + runtime typeof + the exact runtime export-key set, plus
 * that the four type-only re-exports compile.
 */

import { describe, it, expect } from "vitest";

import * as registryFacade from "../../../vex-agent/tools/registry.js";

// Runtime-value re-exports (12). Pinning these as named imports forces
// `tsc --noEmit` to reject signature drift; the typeof assertions cover runtime.
import {
  defaultVisibilityContext,
  getToolDef,
  isInternalTool,
  isMutatingTool,
  getPressureSafety,
  getActionKind,
  getAllTools,
  getVisibleToolDefs,
  getOpenAITools,
  isToolBlockedForRole,
  TOOL_MAP_CATEGORIES,
  getVisibleToolsByCategory,
} from "../../../vex-agent/tools/registry.js";

// Type-only re-exports (4) — erased at runtime; importing them proves the
// façade re-exports the types and that they compile under the new module layout.
import type {
  ToolVisibilityContext,
  ToolVisibilityBase,
  ToolMapCategory,
  VisibleToolMapCategory,
} from "../../../vex-agent/tools/registry.js";

describe("registry façade — public surface", () => {
  it("exposes every runtime export with the correct typeof", () => {
    expect(typeof defaultVisibilityContext).toBe("function");
    expect(typeof getToolDef).toBe("function");
    expect(typeof isInternalTool).toBe("function");
    expect(typeof isMutatingTool).toBe("function");
    expect(typeof getPressureSafety).toBe("function");
    expect(typeof getActionKind).toBe("function");
    expect(typeof getAllTools).toBe("function");
    expect(typeof getVisibleToolDefs).toBe("function");
    expect(typeof getOpenAITools).toBe("function");
    expect(typeof isToolBlockedForRole).toBe("function");
    expect(typeof getVisibleToolsByCategory).toBe("function");
    expect(Array.isArray(TOOL_MAP_CATEGORIES)).toBe(true);
  });

  it("named re-exports are identity-equal to the namespace import", () => {
    expect(registryFacade.defaultVisibilityContext).toBe(defaultVisibilityContext);
    expect(registryFacade.getToolDef).toBe(getToolDef);
    expect(registryFacade.isInternalTool).toBe(isInternalTool);
    expect(registryFacade.isMutatingTool).toBe(isMutatingTool);
    expect(registryFacade.getPressureSafety).toBe(getPressureSafety);
    expect(registryFacade.getActionKind).toBe(getActionKind);
    expect(registryFacade.getAllTools).toBe(getAllTools);
    expect(registryFacade.getVisibleToolDefs).toBe(getVisibleToolDefs);
    expect(registryFacade.getOpenAITools).toBe(getOpenAITools);
    expect(registryFacade.isToolBlockedForRole).toBe(isToolBlockedForRole);
    expect(registryFacade.TOOL_MAP_CATEGORIES).toBe(TOOL_MAP_CATEGORIES);
    expect(registryFacade.getVisibleToolsByCategory).toBe(getVisibleToolsByCategory);
  });

  it("exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(registryFacade).sort();
    expect(keys).toEqual(
      [
        "TOOL_MAP_CATEGORIES",
        "defaultVisibilityContext",
        "getActionKind",
        "getAllTools",
        "getOpenAITools",
        "getPressureSafety",
        "getToolDef",
        "getVisibleToolDefs",
        "getVisibleToolsByCategory",
        "isInternalTool",
        "isMutatingTool",
        "isToolBlockedForRole",
      ].sort(),
    );
  });

  it("type-only re-exports compile (compile-time assertion)", () => {
    // These narrowings only need to type-check; they document that the façade
    // re-exports the four types under their original names.
    const ctx: ToolVisibilityContext = defaultVisibilityContext();
    const base: ToolVisibilityBase = {
      permission: ctx.permission,
      role: ctx.role,
      sessionKind: ctx.sessionKind,
      missionRunActive: ctx.missionRunActive,
      planMode: ctx.planMode,
    };
    const cat: ToolMapCategory = TOOL_MAP_CATEGORIES[0]!;
    const visible: VisibleToolMapCategory = { label: cat.label, toolNames: cat.toolNames };
    expect(base.role).toBe("parent");
    expect(typeof visible.label).toBe("string");
  });
});
