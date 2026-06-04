import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getActiveMission: vi.fn(),
}));

vi.mock("@vex-agent/tools/dispatcher.js", () => ({
  dispatchTool: vi.fn(),
}));

import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import { runTool } from "@vex-agent/engine/core/run-tool.js";

const mockGetSession = sessionsRepo.getSession as unknown as ReturnType<typeof vi.fn>;
const mockGetActiveRun = missionRunsRepo.getActiveRunBySession as unknown as ReturnType<typeof vi.fn>;
const mockGetActiveMission = missionsRepo.getActiveMission as unknown as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchTool as unknown as ReturnType<typeof vi.fn>;

describe("runTool", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetActiveRun.mockReset();
    mockGetActiveMission.mockReset();
    mockDispatch.mockReset();
    mockGetActiveMission.mockResolvedValue(null);
  });

  it("throws when session does not exist", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(runTool("missing", "discover_tools", {})).rejects.toThrow(/Session missing not found/);
  });

  it("builds context from session + active mission run and delegates to dispatcher", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "sess-1",
      mode: "mission",
      permission: "restricted",
      tokenCount: 5000,
      scope: "local_shell",
      startedAt: "2026-01-01",
      endedAt: null,
      summary: null,
      compacted: false,
      messageCount: 3,
      checkpointGeneration: 0,
    });
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-1",
      missionId: "m-1",
      sessionId: "sess-1",
      status: "running",
      iterationCount: 2,
      startedAt: "2026-01-01",
      endedAt: null,
      lastCheckpointAt: null,
      stopReason: null,
      stopPayload: null,
    });
    mockDispatch.mockResolvedValueOnce({ success: true, output: "ok" });

    const result = await runTool("sess-1", "wallet_balances", { wallet: "all" });

    expect(result).toEqual({ success: true, output: "ok" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    const [callArg, ctxArg] = mockDispatch.mock.calls[0] as [
      { name: string; args: Record<string, unknown>; toolCallId: string },
      InternalToolContext,
    ];
    expect(callArg.name).toBe("wallet_balances");
    expect(callArg.args).toEqual({ wallet: "all" });
    expect(callArg.toolCallId).toMatch(/^direct-/);

    expect(ctxArg.sessionId).toBe("sess-1");
    expect(ctxArg.role).toBe("parent");
    expect(ctxArg.approved).toBe(true);
    expect(ctxArg.sessionKind).toBe("mission");
    expect(ctxArg.sessionPermission).toBe("restricted");
    expect(ctxArg.missionRunId).toBe("run-1");
    expect(ctxArg.missionId).toBe("m-1");
    expect(ctxArg.contextUsageBand).toBe("normal");
    expect(ctxArg.sourceSurface).toBe("vex_agent");
    expect(ctxArg.sourceSession).toBe("sess-1");
  });

  it("falls back to null missionRunId when no active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "sess-2",
      mode: "agent",
      permission: "restricted",
      tokenCount: 0,
      scope: "local_shell",
      startedAt: "2026-01-01",
      endedAt: null,
      summary: null,
      compacted: false,
      messageCount: 0,
      checkpointGeneration: 0,
    });
    mockGetActiveRun.mockResolvedValueOnce(null);
    mockDispatch.mockResolvedValueOnce({ success: true, output: "ok" });

    await runTool("sess-2", "discover_tools", { query: "test" });

    const [, ctxArg] = mockDispatch.mock.calls[0] as [
      { name: string; args: Record<string, unknown>; toolCallId: string },
      InternalToolContext,
    ];
    expect(ctxArg.sessionPermission).toBe("restricted");
    expect(ctxArg.missionRunId).toBeNull();
    expect(ctxArg.missionId).toBeNull();
    expect(ctxArg.sessionKind).toBe("agent");
  });

  it("uses mission setup context when a session has a draft but no active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "sess-3",
      mode: "mission",
      permission: "restricted",
      tokenCount: 0,
      scope: "local_shell",
      startedAt: "2026-01-01",
      endedAt: null,
      summary: null,
      compacted: false,
      messageCount: 0,
      checkpointGeneration: 0,
    });
    mockGetActiveRun.mockResolvedValueOnce(null);
    mockGetActiveMission.mockResolvedValueOnce({ id: "mission-3" });
    mockDispatch.mockResolvedValueOnce({ success: true, output: "ok" });

    await runTool("sess-3", "mission_draft_update", { title: "Edit" });

    const [, ctxArg] = mockDispatch.mock.calls[0] as [
      { name: string; args: Record<string, unknown>; toolCallId: string },
      InternalToolContext,
    ];
    expect(ctxArg.sessionKind).toBe("mission");
    expect(ctxArg.missionRunId).toBeNull();
    expect(ctxArg.missionId).toBe("mission-3");
  });
});
