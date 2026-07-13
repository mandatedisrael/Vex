import { beforeEach, describe, expect, it, vi } from "vitest";

const loadPreferences = vi.fn();
const broadcast = vi.fn();

vi.mock("../../preferences/store.js", () => ({
  preferencesStore: { load: (...args: unknown[]) => loadPreferences(...args) },
}));
vi.mock("../../lifecycle/broadcast.js", () => ({
  broadcastToAllWindows: (...args: unknown[]) => broadcast(...args),
}));

const {
  initializeHyperliquidWorkspaceModeProvider,
  listHypervexingSessionIds,
  requestHyperliquidWorkspaceMode,
  resetHyperliquidWorkspaceModes,
} = await import("../workspace-mode.js");
const { EV } = await import("@shared/ipc/channels.js");
const { resolveHlWorkspaceMode } = await import("@vex-lib/hyperliquid-workspace-mode.js");

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

describe("main-owned Hypervexing workspace mode", () => {
  beforeEach(() => {
    loadPreferences.mockReset();
    broadcast.mockReset();
    resetHyperliquidWorkspaceModes();
    initializeHyperliquidWorkspaceModeProvider();
  });

  it.each([
    [null, false],
    ["2026-07-12T10:00:00.000Z", true],
  ] as const)("annotates first-entry acknowledgment %s", async (riskAcknowledgedAt, acknowledged) => {
    loadPreferences.mockResolvedValueOnce({ hyperliquid: { riskAcknowledgedAt } });
    const event = await requestHyperliquidWorkspaceMode(SESSION_ID, "hypervexing");
    expect(event).toEqual({ sessionId: SESSION_ID, mode: "hypervexing", requestedBy: "agent", acknowledged });
    expect(broadcast).toHaveBeenCalledWith(EV.hyperliquid.workspaceMode, event);
    expect(resolveHlWorkspaceMode(SESSION_ID)).toBe("hypervexing");
  });

  it("uses the same authority for manual exit", async () => {
    loadPreferences.mockResolvedValueOnce({ hyperliquid: { riskAcknowledgedAt: null } });
    const event = await requestHyperliquidWorkspaceMode(SESSION_ID, "normal");
    expect(event).toEqual({ sessionId: SESSION_ID, mode: "normal", requestedBy: "agent", acknowledged: false });
    expect(resolveHlWorkspaceMode(SESSION_ID)).toBe("normal");
  });

  it("is idempotent for an already-active requested mode and does not rebroadcast", async () => {
    loadPreferences.mockResolvedValue({ hyperliquid: { riskAcknowledgedAt: "2026-07-12T10:00:00.000Z" } });

    const first = await requestHyperliquidWorkspaceMode(SESSION_ID, "hypervexing");
    const repeated = await requestHyperliquidWorkspaceMode(SESSION_ID, "hypervexing");

    expect(repeated).toEqual(first);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(resolveHlWorkspaceMode(SESSION_ID)).toBe("hypervexing");
  });

  it("lists only transiently Hypervexing sessions for main-owned background consumers", async () => {
    const secondSessionId = "00000000-0000-4000-8000-000000000002";
    loadPreferences.mockResolvedValue({ hyperliquid: { riskAcknowledgedAt: null } });

    await requestHyperliquidWorkspaceMode(SESSION_ID, "hypervexing");
    await requestHyperliquidWorkspaceMode(secondSessionId, "normal");

    expect(listHypervexingSessionIds()).toEqual([SESSION_ID]);
  });
});
