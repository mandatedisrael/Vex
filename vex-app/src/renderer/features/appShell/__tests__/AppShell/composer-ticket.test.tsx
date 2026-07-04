/**
 * Order Ticket chrome (feat/robinhood-launch) — the composer's instrument
 * redesign. Mounts the real `SessionComposer` with the lib/api hooks mocked
 * (same isolated harness as composer-plan-switch) and pins the new visual
 * contract WITHOUT touching any submit/gating behavior:
 *
 *   - the EXECUTE key (mono pill): "Execute" label, disabled while the field
 *     is empty, enabled once there is an order to send, accent-contrast fill;
 *   - the prompt glyph: `idle` (breathing) when empty, `active` while typing;
 *   - the header microbar eyebrow: MISSION INPUT on welcome, AGENT INPUT for
 *     an agent session, and the amber AWAITING YOUR SIGNATURE approval echo
 *     driven by the existing `runStatus === "paused_approval"` signal;
 *   - the welcome-stage-only PROPOSE → ENFORCE → PROVE flow strip;
 *   - the new plain-English welcome placeholder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MissionRunStatus, SessionListItem } from "@shared/schemas/sessions.js";
import { useUiStore } from "../../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
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

// Runtime status is reconfigurable so the approval-echo test can drive
// `paused_approval` while every other test stays on the free (null) state.
let runStatus: MissionRunStatus | null = null;
vi.mock("../../../../lib/api/runtime.js", () => ({
  useRuntimeState: () => ({ data: { ok: true, data: { status: runStatus } } }),
}));

vi.mock("../../../../lib/api/sessions.js", () => ({
  useSessionPlan: () => ({
    data: { ok: true, data: { enabled: false, planMd: "", accepted: false } },
  }),
  useSetPlanMode: () => ({ mutate: vi.fn(), isPending: false }),
  // Capability unknown → the REASON control stays hidden in this suite.
  useSessionModel: () => ({ data: undefined }),
}));

const { SessionComposer } = await import("../../SessionComposer.js");

const SESSION = "00000000-0000-4000-8000-00000000cc01";

function agentRow(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: SESSION,
    mode: "agent",
    permission: "restricted",
    title: "Ticket",
    initialGoal: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runStatus = null;
  useUiStore.setState({
    pendingFirstMessage: null,
    createSessionInitialMessage: null,
  });
});

describe("SessionComposer — Order Ticket chrome", () => {
  it("wraps the composer in the .vex-ticket instrument frame", () => {
    const { container } = render(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    const form = container.querySelector('[data-vex-area="chat-composer"]');
    expect(form).not.toBeNull();
    expect(form?.className).toContain("vex-ticket");
    expect(form?.getAttribute("data-vex-ticket-state")).toBe("input");
  });

  it("EXECUTE key is disabled while empty and enabled once typed", () => {
    render(<SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />);
    const send = screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
    // Mono pill label ("Execute"; CSS uppercases it) + accent-contrast fill.
    expect(send.textContent).toContain("Execute");
    expect(send.disabled).toBe(true);
    expect(send.className).not.toContain("vex-accent-contrast");

    fireEvent.change(screen.getByLabelText("Session draft"), {
      target: { value: "buy the dip" },
    });
    expect(send.disabled).toBe(false);
    // Enabled fill paints the accent-contrast ink (white on cobalt / ink on lime).
    expect(send.className).toContain("vex-accent-contrast");
  });

  it("breathes the prompt glyph while empty, solid while typing", () => {
    const { container } = render(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    const glyph = () => container.querySelector("[data-vex-ticket-glyph]");
    expect(glyph()?.getAttribute("data-vex-ticket-glyph")).toBe("idle");
    expect(glyph()?.className).toContain("vex-ticket-glyph--idle");

    fireEvent.change(screen.getByLabelText("Session draft"), {
      target: { value: "x" },
    });
    expect(glyph()?.getAttribute("data-vex-ticket-glyph")).toBe("active");
    expect(glyph()?.className).not.toContain("vex-ticket-glyph--idle");
  });

  it("shows the flow strip ONLY on the welcome stage", () => {
    const { container, rerender } = render(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    expect(container.querySelector("[data-vex-ticket-flow]")).toBeNull();

    rerender(
      <SessionComposer activeSession={null} activeSessionId={null} stage />,
    );
    const flow = container.querySelector("[data-vex-ticket-flow]");
    expect(flow).not.toBeNull();
    expect(flow?.textContent).toContain("Propose");
    expect(flow?.textContent).toContain("Enforce");
    expect(flow?.textContent).toContain("Prove");
  });

  it("names the instrument context in the header eyebrow", () => {
    const { container, rerender } = render(
      <SessionComposer activeSession={null} activeSessionId={null} />,
    );
    const eyebrow = () => container.querySelector("[data-vex-ticket-eyebrow]");
    expect(eyebrow()?.textContent).toBe("MISSION INPUT");
    expect(eyebrow()?.getAttribute("data-vex-ticket-eyebrow")).toBe("input");

    rerender(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    expect(eyebrow()?.textContent).toBe("AGENT INPUT");
  });

  it("flips the chrome + eyebrow to the amber approval echo (paused_approval)", () => {
    runStatus = "paused_approval";
    const { container } = render(
      <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />,
    );
    const form = container.querySelector('[data-vex-area="chat-composer"]');
    expect(form?.getAttribute("data-vex-ticket-state")).toBe("approval");
    const eyebrow = container.querySelector("[data-vex-ticket-eyebrow]");
    expect(eyebrow?.textContent).toBe("AWAITING YOUR SIGNATURE");
    expect(eyebrow?.getAttribute("data-vex-ticket-eyebrow")).toBe("approval");
  });

  it("uses the plain-English welcome placeholder", () => {
    render(<SessionComposer activeSession={null} activeSessionId={null} />);
    const draft = screen.getByLabelText("Session draft") as HTMLTextAreaElement;
    expect(draft.placeholder).toBe(
      "Short gold in this range, stop at 4170. Plain English.",
    );
  });

  it("renders under the Robinhood theme without leaking raw colors (token-only)", () => {
    // jsdom does not resolve CSS vars; the token-only classNames are what
    // guarantee both themes recolor. Smoke-mount inside the theme scope and
    // confirm the EXECUTE fill still routes through the accent-contrast token.
    render(
      <div data-vex-shell="true" data-vex-theme="robinhood">
        <SessionComposer activeSession={agentRow()} activeSessionId={SESSION} />
      </div>,
    );
    fireEvent.change(screen.getByLabelText("Session draft"), {
      target: { value: "go" },
    });
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send.className).toContain("var(--vex-accent-contrast)");
  });
});
