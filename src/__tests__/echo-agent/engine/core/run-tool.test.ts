import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
}));

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: vi.fn(),
}));

vi.mock("@echo-agent/tools/dispatcher.js", () => ({
  dispatchTool: vi.fn(),
}));

import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { runTool } from "@echo-agent/engine/core/run-tool.js";

const mockGetSession = sessionsRepo.getSession as unknown as ReturnType<typeof vi.fn>;
const mockGetActiveRun = missionRunsRepo.getActiveRunBySession as unknown as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchTool as unknown as ReturnType<typeof vi.fn>;

describe("runTool", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockGetActiveRun.mockReset();
    mockDispatch.mockReset();
  });

  it("throws when session does not exist", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    await expect(runTool("missing", "discover_tools", {})).rejects.toThrow(/Session missing not found/);
  });

  it("builds context from session + active mission run and delegates to dispatcher", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "sess-1",
      kind: "chat",
      tokenCount: 5000,
      scope: "local_shell",
      startedAt: "2026-01-01",
      endedAt: null,
      summary: null,
      compacted: false,
      messageCount: 3,
      memoryScopeKey: "sess-1",
      memoryLanguageCode: null,
      checkpointGeneration: 0,
    });
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-1",
      loopMode: "restricted",
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

    const result = await runTool("sess-1", "wallet_read", { view: "balances" });

    expect(result).toEqual({ success: true, output: "ok" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    const [callArg, ctxArg] = mockDispatch.mock.calls[0] as [
      { name: string; args: Record<string, unknown>; toolCallId: string },
      InternalToolContext,
    ];
    expect(callArg.name).toBe("wallet_read");
    expect(callArg.args).toEqual({ view: "balances" });
    expect(callArg.toolCallId).toMatch(/^direct-/);

    expect(ctxArg.sessionId).toBe("sess-1");
    expect(ctxArg.role).toBe("parent");
    expect(ctxArg.approved).toBe(true);
    expect(ctxArg.sessionKind).toBe("chat");
    expect(ctxArg.loopMode).toBe("restricted");
    expect(ctxArg.missionRunId).toBe("run-1");
    expect(ctxArg.contextUsageBand).toBe("normal");
  });

  it("falls back to loopMode='off' and null missionRunId when no active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "sess-2",
      kind: "full_autonomous",
      tokenCount: 0,
      scope: "local_shell",
      startedAt: "2026-01-01",
      endedAt: null,
      summary: null,
      compacted: false,
      messageCount: 0,
      memoryScopeKey: "sess-2",
      memoryLanguageCode: null,
      checkpointGeneration: 0,
    });
    mockGetActiveRun.mockResolvedValueOnce(null);
    mockDispatch.mockResolvedValueOnce({ success: true, output: "ok" });

    await runTool("sess-2", "discover_tools", { query: "test" });

    const [, ctxArg] = mockDispatch.mock.calls[0] as [
      { name: string; args: Record<string, unknown>; toolCallId: string },
      InternalToolContext,
    ];
    expect(ctxArg.loopMode).toBe("off");
    expect(ctxArg.missionRunId).toBeNull();
    expect(ctxArg.sessionKind).toBe("full_autonomous");
  });
});
