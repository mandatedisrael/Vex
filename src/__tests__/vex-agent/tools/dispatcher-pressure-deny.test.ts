/**
 * Dispatcher hard-deny + protocol runtime pressure guard — codex P2 #3 (round 3)
 * required gates that lacked direct coverage.
 *
 * The cutover exposes TWO independent pressure barriers at runtime:
 *   1. `checkPressureDeny` in `tools/dispatcher.ts` — synthetic error for any
 *      `mutating` / `compact_only` call that bypassed the catalog projection.
 *   2. Inline guard in `tools/protocols/runtime.ts:executeProtocolTool` — same
 *      shape for the protocol meta-tool namespace (`discover_tools` /
 *      `execute_tool` → `executeProtocolTool`).
 *
 * Both must reject at barrier+ with a clear hint pointing the agent at
 * `compact_now`. The catalog-level filter (already covered in
 * `tools/registry.test.ts`) is the soft signal; these are the runtime guards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level vi.mocks (hoisted) ──────────────────────────────────
// Mock identifiers must be declared at module scope BEFORE `vi.mock` calls
// reach them after hoist. Putting them inside `describe` triggers a TDZ.

const mockGetManifest = vi.fn();
const mockGetHandler = vi.fn();

vi.mock("../../../vex-agent/tools/protocols/catalog.js", () => ({
  getProtocolManifest: (...a: unknown[]) => mockGetManifest(...a),
  getProtocolHandler: (...a: unknown[]) => mockGetHandler(...a),
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

vi.mock("../../../vex-agent/tools/protocols/capture-validator.js", () => ({
  isPreviewExecution: vi.fn().mockReturnValue(false),
  validateCaptureContract: vi.fn().mockReturnValue(true),
}));

vi.mock("../../../vex-agent/tools/protocols/capture-pipeline.js", () => ({
  extractExternalRefs: vi.fn().mockReturnValue([]),
  populateCaptureItems: vi.fn(),
}));

vi.mock("../../../vex-agent/tools/protocols/lifecycle.js", () => ({
  isExecutableNamespace: vi.fn().mockReturnValue(true),
  NAMESPACE_LIFECYCLE: {},
}));

vi.mock("../../../vex-agent/tools/protocols/mutation-matrix.js", () => ({
  MUTATION_MATRIX: new Map(),
}));

vi.mock("../../../vex-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../../vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn(),
}));

import { checkPressureDeny } from "../../../vex-agent/tools/dispatcher.js";
import { executeProtocolTool } from "../../../vex-agent/tools/protocols/runtime.js";
import type { ContextUsageBand } from "../../../vex-agent/engine/core/context-band.js";

describe("checkPressureDeny — runtime hard-deny (dispatcher)", () => {
  it("returns null for unknown tool names (routing layer produces the error)", () => {
    expect(checkPressureDeny("nonexistent_tool", "barrier")).toBeNull();
    expect(checkPressureDeny("nonexistent_tool", "critical")).toBeNull();
    expect(checkPressureDeny("nonexistent_tool", "normal")).toBeNull();
  });

  it("blocks mutating tools at barrier band with a compact_now hint", () => {
    const result = checkPressureDeny("wallet_send_confirm", "barrier");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.output).toContain("blocked");
    expect(result!.output).toContain("barrier");
    expect(result!.output).toContain("compact_now");
  });

  it("blocks mutating tools at critical band", () => {
    const result = checkPressureDeny("wallet_send_confirm", "critical");
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.output).toContain("critical");
  });

  it("does NOT block mutating tools at normal band", () => {
    expect(checkPressureDeny("wallet_send_confirm", "normal")).toBeNull();
  });

  it("does NOT block mutating tools at warning band (the LLM still sees them)", () => {
    expect(checkPressureDeny("wallet_send_confirm", "warning")).toBeNull();
  });

  it("blocks compact_only tools below barrier", () => {
    const normal = checkPressureDeny("compact_now", "normal");
    const warning = checkPressureDeny("compact_now", "warning");
    expect(normal).not.toBeNull();
    expect(warning).not.toBeNull();
    expect(normal!.success).toBe(false);
    expect(warning!.success).toBe(false);
    expect(normal!.output).toContain("only available at context pressure barrier");
  });

  it("ALLOWS compact_only tools at barrier and critical", () => {
    expect(checkPressureDeny("compact_now", "barrier")).toBeNull();
    expect(checkPressureDeny("compact_now", "critical")).toBeNull();
  });

  it("ALLOWS read_only tools at every band", () => {
    const bands: ContextUsageBand[] = ["normal", "warning", "barrier", "critical"];
    for (const band of bands) {
      expect(checkPressureDeny("memory_recall", band), `memory_recall @ ${band}`).toBeNull();
      expect(checkPressureDeny("knowledge_recall", band), `knowledge_recall @ ${band}`).toBeNull();
      expect(checkPressureDeny("wallet_balances", band), `wallet_balances @ ${band}`).toBeNull();
    }
  });
});

describe("executeProtocolTool — pressure guard (protocol runtime)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeManifest(toolId: string, mutating: boolean) {
    return {
      namespace: "test_ns",
      toolId,
      mutating,
      lifecycle: "active" as const,
      params: [],
    };
  }

  it("blocks a mutating protocol tool at barrier band", async () => {
    mockGetManifest.mockReturnValue(makeManifest("test.mutate", true));
    mockGetHandler.mockReturnValue(vi.fn());

    const result = await executeProtocolTool(
      { toolId: "test.mutate", params: {} },
      {
        sessionPermission: "full",
        approved: false,
        sessionId: "s-1",
        contextUsageBand: "barrier",
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("blocked");
    expect(result.output).toContain("barrier");
    expect(result.output).toContain("compact_now");
    // Handler must NOT have been called.
    expect(mockGetHandler).not.toHaveBeenCalled();
  });

  it("blocks a mutating protocol tool at critical band", async () => {
    mockGetManifest.mockReturnValue(makeManifest("test.mutate", true));
    mockGetHandler.mockReturnValue(vi.fn());

    const result = await executeProtocolTool(
      { toolId: "test.mutate", params: {} },
      {
        sessionPermission: "full",
        approved: false,
        sessionId: "s-1",
        contextUsageBand: "critical",
      },
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("critical");
  });

  it("ALLOWS a non-mutating protocol tool at barrier", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    mockGetManifest.mockReturnValue(makeManifest("test.read", false));
    mockGetHandler.mockReturnValue(handler);

    const result = await executeProtocolTool(
      { toolId: "test.read", params: {} },
      {
        sessionPermission: "full",
        approved: false,
        sessionId: "s-1",
        contextUsageBand: "barrier",
      },
    );

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("ALLOWS a mutating protocol tool at normal band", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    mockGetManifest.mockReturnValue(makeManifest("test.mutate", true));
    mockGetHandler.mockReturnValue(handler);

    const result = await executeProtocolTool(
      { toolId: "test.mutate", params: {} },
      {
        sessionPermission: "full",
        approved: true,
        sessionId: "s-1",
        contextUsageBand: "normal",
      },
    );

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("ALLOWS a mutating protocol tool at warning band (only barrier+ blocks)", async () => {
    const handler = vi.fn().mockResolvedValue({ success: true, output: "ok" });
    mockGetManifest.mockReturnValue(makeManifest("test.mutate", true));
    mockGetHandler.mockReturnValue(handler);

    const result = await executeProtocolTool(
      { toolId: "test.mutate", params: {} },
      {
        sessionPermission: "full",
        approved: true,
        sessionId: "s-1",
        contextUsageBand: "warning",
      },
    );

    expect(result.success).toBe(true);
    expect(handler).toHaveBeenCalled();
  });
});
