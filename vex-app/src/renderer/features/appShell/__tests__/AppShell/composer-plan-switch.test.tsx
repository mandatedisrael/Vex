/**
 * Composer PLAN switch (S2) — the plan-mode toggle behavior that moved out of
 * `SessionPlanCard` into the composer chrome. Mounts the real SessionComposer
 * with the lib/api hooks mocked so the suite pins:
 *   - role="switch" + aria-checked reflecting engine-owned plan state,
 *   - toggling calls useSetPlanMode with { sessionId, enabled: !current },
 *   - real `disabled` on welcome (no session) and on a mission parked for
 *     plan acceptance (the state where the engine refuses toggles),
 *   - the plan-on placeholder + welcome trust letterpress.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useUiStore } from "../../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  ArrowRight01Icon: "ArrowRight01Icon",
  ArrowUp01Icon: "ArrowUp01Icon",
  MapPinIcon: "MapPinIcon",
  StopCircleIcon: "StopCircleIcon",
}));

const mockSubmitChat = {
  isPending: false,
  mutateAsync: vi.fn(),
  stop: vi.fn(),
};
vi.mock("../../../../lib/api/chat.js", () => ({
  useSubmitChat: () => mockSubmitChat,
}));
vi.mock("../../../../lib/api/messages.js", () => ({
  useTranscriptInfinite: () => ({ data: undefined, isSuccess: false }),
  flattenTranscriptPages: () => [],
}));
vi.mock("../../../../lib/api/runtime.js", () => ({
  useRuntimeState: () => ({ data: { ok: true, data: { status: null } } }),
}));

const mockUseSessionPlan = vi.fn();
const mockSetPlanMode = { mutate: vi.fn(), isPending: false };
vi.mock("../../../../lib/api/sessions.js", () => ({
  useSessionPlan: (...a: unknown[]) => mockUseSessionPlan(...a),
  useSetPlanMode: () => mockSetPlanMode,
  // S6: SessionComposer also reads the model capability — capability unknown
  // here, so the REASON control stays hidden in this suite.
  useSessionModel: () => ({ data: undefined }),
}));

const { SessionComposer } = await import("../../SessionComposer.js");

const SESSION = "00000000-0000-4000-8000-00000000bb01";

function agentRow(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION,
    mode: "agent",
    permission: "restricted",
    title: "Plan switch",
    initialGoal: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...over,
  };
}

function planState(enabled: boolean) {
  return {
    data: {
      ok: true as const,
      data: { enabled, planMd: "", accepted: false },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetPlanMode.isPending = false;
  mockUseSessionPlan.mockReturnValue(planState(false));
  useUiStore.setState({
    pendingFirstMessage: null,
    createSessionInitialMessage: null,
  });
});

describe("SessionComposer plan switch", () => {
  it("toggles plan mode ON via useSetPlanMode for the active session", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const sw = screen.getByRole("switch", { name: "Plan mode" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.getAttribute("data-vex-plan-mode")).toBe("off");
    fireEvent.click(sw);
    expect(mockSetPlanMode.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
      enabled: true,
    });
  });

  it("reflects the ON state, swaps the placeholder, and toggles OFF", () => {
    mockUseSessionPlan.mockReturnValue(planState(true));
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const sw = screen.getByRole("switch", { name: "Plan mode" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.getAttribute("data-vex-plan-mode")).toBe("on");
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    expect(draft.placeholder).toBe(
      "Describe the goal — Vex proposes a plan before anything executes.",
    );
    fireEvent.click(sw);
    expect(mockSetPlanMode.mutate).toHaveBeenCalledWith({
      sessionId: SESSION,
      enabled: false,
    });
  });

  it("is truly disabled on welcome (no session) and renders the trust letterpress", () => {
    render(<SessionComposer activeSession={null} activeSessionId={null} />);
    const sw = screen.getByRole("switch", { name: "Plan mode" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.title).toBe("Available once a session is open");
    expect(
      screen.getByText("Local-first · Private by default · You sign every action"),
    ).toBeTruthy();
  });

  it("is disabled while a mission is parked for plan acceptance", () => {
    mockUseSessionPlan.mockReturnValue(planState(true));
    render(
      <SessionComposer
        activeSession={agentRow({ mode: "mission", missionStatus: "paused_plan_acceptance" })}
        activeSessionId={SESSION}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Plan mode" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.title).toBe("Unavailable while a mission is running");
  });
});
