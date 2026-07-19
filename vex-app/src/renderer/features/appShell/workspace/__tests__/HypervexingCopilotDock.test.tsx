/**
 * HypervexingCopilotDock — the docked chat surface for the Hypervexing room.
 *
 * The room replaces the normal shell, which hosts the MISSION RAIL (the mission
 * contract/plan badges that open the Accept & Start dialogs) in its DESK RULE
 * header. Without surfacing that rail in the room, a mission drafted inside the
 * workspace strands on the "contract not accepted" notice with no reachable
 * Accept control. These tests pin that the dock feeds `MissionRail` into the
 * docked panel's header slot and that the real rail mounts/self-gates + opens
 * its contract dialog in the workspace context.
 *
 * SessionPanel is stubbed to a surface that renders its `headerTrailing` slot,
 * so the dock→panel wiring and the REAL MissionRail behaviour are exercised
 * without pulling in the panel's heavy live-sync hook tree. MissionRail's API
 * hooks are mocked (no IPC) and its review modals are stubbed to open-markers,
 * mirroring MissionRail.test.tsx. @hugeicons/react is mocked (ESM-heavy glyph).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionDraftDto,
  MissionGetDiffResult,
} from "@shared/schemas/mission.js";
import type { PlanGetResult } from "@shared/schemas/session-plan.js";
import type { SessionListItem } from "@shared/schemas/sessions.js";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));

// Stub the docked panel to a surface that renders whatever header slot it is
// given — the dock's contract with SessionPanel is exactly `headerTrailing`.
vi.mock("../../SessionPanel.js", () => ({
  SessionPanel: ({ headerTrailing }: { headerTrailing?: ReactNode }) => (
    <div data-testid="session-panel">{headerTrailing}</div>
  ),
}));

const mockUseSession = vi.fn();
const mockUseMissionDraft = vi.fn();
const mockUseMissionDiff = vi.fn();
const mockUseSessionPlan = vi.fn();
const mockUseRenewableMissionSource = vi.fn();
const mockUseRuntimeState = vi.fn();

vi.mock("../../../../lib/api/sessions.js", () => ({
  useSession: (...a: unknown[]) => mockUseSession(...a),
  useSessionPlan: (...a: unknown[]) => mockUseSessionPlan(...a),
}));
vi.mock("../../../../lib/api/mission.js", () => ({
  useMissionDraft: (...a: unknown[]) => mockUseMissionDraft(...a),
  useMissionDiff: (...a: unknown[]) => mockUseMissionDiff(...a),
  useRenewableMissionSource: (...a: unknown[]) =>
    mockUseRenewableMissionSource(...a),
}));
vi.mock("../../../../lib/api/runtime.js", () => ({
  useRuntimeState: (...a: unknown[]) => mockUseRuntimeState(...a),
}));

vi.mock("../../MissionContractModal.js", () => ({
  MissionContractModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="mission-modal-open" /> : null,
}));
vi.mock("../../PlanDisplayModal.js", () => ({
  PlanDisplayModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="plan-modal-open" /> : null,
}));

const SESSION = "00000000-0000-4000-8000-00000000dc01";
const MISSION = "mission-1";
const HASH = "a".repeat(64);

// REAL uiStore (no static mock): MissionRail's dialog state moved to
// uiStore.reviewModal, so the rail's reads/writes are reactive store state —
// a fixed-selector mock would swallow the badge click. Tests drive
// activeSessionId/reviewModal via useUiStore.setState (reset in beforeEach).
const { useUiStore } = await import("../../../../stores/uiStore.js");

const { HypervexingCopilotDock } = await import("../HypervexingCopilotDock.js");

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function sessionRow(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION,
    mode: "agent",
    permission: "restricted",
    title: "hl",
    initialGoal: null,
    startedAt: "2026-05-26T10:00:00.000Z",
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...over,
  };
}

const READY_DRAFT = {
  missionId: MISSION,
  sessionId: SESSION,
  status: "ready",
  title: "Rebalance LP",
  goal: "Move USDC.",
  constraints: {},
  successCriteria: [],
  stopConditions: [],
  riskProfile: "balanced",
  allowedChains: [],
  allowedProtocols: [],
  allowedWallets: [],
  createdAt: "2026-05-22T08:00:00.000Z",
  updatedAt: "2026-05-22T09:00:00.000Z",
  approvedAt: null,
  acceptance: null,
  renewedFromMissionId: null,
} as unknown as MissionDraftDto;

function diff(
  over: Partial<Extract<MissionGetDiffResult, { outcome: "ready" }>> = {},
) {
  return {
    outcome: "ready" as const,
    missionId: MISSION,
    sessionId: SESSION,
    currentHash: HASH,
    contractHashVersion: 1,
    acceptedHash: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptedContractHashVersion: null,
    isAccepted: false,
    isDirty: false,
    ...over,
  };
}

function plan(over: Partial<PlanGetResult> = {}): PlanGetResult {
  return {
    enabled: false,
    planMd: "",
    accepted: false,
    acceptedAt: null,
    updatedAt: "2026-05-22T09:15:00.000Z",
    ...over,
  } as PlanGetResult;
}

function runtime(hasActiveRun = false) {
  return ok({
    sessionId: SESSION,
    hasActiveRun,
    missionRunId: null,
    status: null,
    stopReason: null,
    lastCheckpointAt: null,
    startedAt: null,
    iterationCount: null,
    leaseActive: false,
    leaseExpiresAt: null,
    pendingControlKind: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ activeSessionId: SESSION, reviewModal: "none" });
  mockUseSession.mockReturnValue({ data: ok(sessionRow()) });
  mockUseMissionDraft.mockReturnValue({ data: ok(null) });
  mockUseMissionDiff.mockReturnValue({ data: undefined });
  mockUseSessionPlan.mockReturnValue({ data: ok(plan()) });
  mockUseRuntimeState.mockReturnValue({ data: runtime(false) });
  mockUseRenewableMissionSource.mockReturnValue({ data: ok(null) });
});

describe("HypervexingCopilotDock mission rail", () => {
  it("always mounts the docked chat panel", () => {
    render(<HypervexingCopilotDock />);
    expect(screen.getByTestId("session-panel")).not.toBeNull();
  });

  it("surfaces MissionRail in the panel header slot for an unaccepted mission contract", () => {
    // A drafted-but-unaccepted mission (the bug's exact state): the rail must
    // appear so its Accept control is reachable inside the room.
    mockUseSession.mockReturnValue({ data: ok(sessionRow({ mode: "mission" })) });
    mockUseMissionDraft.mockReturnValue({ data: ok(READY_DRAFT) });
    mockUseMissionDiff.mockReturnValue({ data: ok(diff({ isAccepted: false })) });

    const { container } = render(<HypervexingCopilotDock />);

    const railInSlot = container
      .querySelector('[data-testid="session-panel"]')
      ?.querySelector('[data-vex-area="mission-rail"]');
    expect(railInSlot).not.toBeNull();
    expect(screen.getByText("Mission")).not.toBeNull();
  });

  it("self-gates to null for a plain agent session with plan-mode off (no ghost rail)", () => {
    mockUseSession.mockReturnValue({ data: ok(sessionRow({ mode: "agent" })) });
    mockUseSessionPlan.mockReturnValue({ data: ok(plan({ enabled: false })) });

    const { container } = render(<HypervexingCopilotDock />);

    expect(
      container.querySelector('[data-vex-area="mission-rail"]'),
    ).toBeNull();
    // The chat panel is unaffected.
    expect(screen.getByTestId("session-panel")).not.toBeNull();
  });

  it("opens the mission contract dialog from the badge inside the room", () => {
    mockUseSession.mockReturnValue({ data: ok(sessionRow({ mode: "mission" })) });
    mockUseMissionDraft.mockReturnValue({ data: ok(READY_DRAFT) });
    mockUseMissionDiff.mockReturnValue({ data: ok(diff({ isAccepted: false })) });

    render(<HypervexingCopilotDock />);

    expect(screen.queryByTestId("mission-modal-open")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mission/i }));
    expect(screen.getByTestId("mission-modal-open")).not.toBeNull();
  });

  it("passes a null active session straight through (rail render-gates off)", () => {
    useUiStore.setState({ activeSessionId: null });
    mockUseSession.mockReturnValue({ data: undefined });

    const { container } = render(<HypervexingCopilotDock />);

    expect(
      container.querySelector('[data-vex-area="mission-rail"]'),
    ).toBeNull();
    expect(screen.getByTestId("session-panel")).not.toBeNull();
  });
});
