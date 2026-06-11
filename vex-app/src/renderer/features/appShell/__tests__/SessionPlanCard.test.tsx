/**
 * SessionPlanCard — render + interaction states for the plan display card.
 *
 * The on/off toggle moved to the composer's PLAN switch (S2) — its behavior
 * is pinned in `AppShell/composer-plan-switch.test.tsx`; here we pin that the
 * card no longer renders a toggle. Still exercises the hooks the card depends
 * on (useSessionPlan, useAcceptPlan, useRequestResume; the sessions-api mock
 * keeps a useSetPlanMode stub for the module surface) so the component is
 * covered on its own — the regression that broke
 * SessionPanel-approval.test.tsx was a missing useRequestResume mock, which
 * this card lacked any direct test to catch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockUseSessionPlan = vi.fn();
const mockSetPlanMode = { mutate: vi.fn(), isPending: false, data: undefined as unknown };
const mockAcceptPlan = { mutate: vi.fn(), isPending: false };
const mockRequestResume = { mutate: vi.fn(), isPending: false };

vi.mock("../../../lib/api/sessions.js", () => ({
  useSessionPlan: (...a: unknown[]) => mockUseSessionPlan(...a),
  useSetPlanMode: () => mockSetPlanMode,
  useAcceptPlan: () => mockAcceptPlan,
}));
vi.mock("../../../lib/api/runtime.js", () => ({
  useRequestResume: () => mockRequestResume,
}));
vi.mock("../../../lib/markdown/MarkdownContent.js", () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="plan-md">{text}</div>,
}));

const { SessionPlanCard } = await import("../SessionPlanCard.js");

const SESSION = "00000000-0000-4000-8000-00000000aa01";
type PlanState = { enabled: boolean; planMd: string; accepted: boolean };
function planQuery(over: Partial<PlanState>) {
  return {
    data: { ok: true as const, data: { enabled: false, planMd: "", accepted: false, ...over } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetPlanMode.data = undefined;
  mockSetPlanMode.isPending = false;
  mockAcceptPlan.isPending = false;
  mockRequestResume.isPending = false;
  mockUseSessionPlan.mockReturnValue(planQuery({}));
});

describe("SessionPlanCard", () => {
  it("renders no plan-mode toggle (the control point is the composer's PLAN switch)", () => {
    render(<SessionPlanCard sessionId={SESSION} />);
    expect(screen.queryByText("Off — turn on")).toBeNull();
    expect(screen.queryByText("On — turn off")).toBeNull();
    expect(screen.queryByTestId("plan-md")).toBeNull();
    expect(screen.queryByText("Accept plan")).toBeNull();
    expect(mockSetPlanMode.mutate).not.toHaveBeenCalled();
  });

  it("shows a pending plan and accepts it with the exact reviewed content", () => {
    mockUseSessionPlan.mockReturnValue(planQuery({ enabled: true, planMd: "# Plan\nstep one", accepted: false }));
    render(<SessionPlanCard sessionId={SESSION} />);
    expect(screen.getByText("Pending your acceptance")).toBeTruthy();
    expect(screen.getByTestId("plan-md").textContent).toContain("step one");
    fireEvent.click(screen.getByText("Accept plan"));
    expect(mockAcceptPlan.mutate).toHaveBeenCalledWith({ sessionId: SESSION, expectedPlanMd: "# Plan\nstep one" });
  });

  it("offers Resume when accepted but the run is still parked for acceptance", () => {
    mockUseSessionPlan.mockReturnValue(planQuery({ enabled: true, planMd: "# Plan", accepted: true }));
    render(<SessionPlanCard sessionId={SESSION} missionStatus="paused_plan_acceptance" />);
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.queryByText("Accept plan")).toBeNull();
    fireEvent.click(screen.getByText("Resume mission"));
    expect(mockRequestResume.mutate).toHaveBeenCalledWith({ sessionId: SESSION });
  });

  it("does NOT offer Resume for an accepted plan when the run is not parked", () => {
    mockUseSessionPlan.mockReturnValue(planQuery({ enabled: true, planMd: "# Plan", accepted: true }));
    render(<SessionPlanCard sessionId={SESSION} missionStatus="running" />);
    expect(screen.queryByText("Resume mission")).toBeNull();
  });

  // The blocked-pending-acceptance hint was removed in S3: the card no longer
  // calls useSetPlanMode (S2 moved toggling to the composer's PLAN switch), so
  // its mutation-refusal state could never fire from this component.
});
