/**
 * MissionControls — runtime-gated mission control surface (Phase 4b-2).
 * Verifies Start gating, the status-gated toolbar (Continue/Recover/Edit/Stop),
 * dispatch wiring to the mission IPC, the in-flight/pending disable, and that
 * refusal outcomes (ok:true non-success) surface a notice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { MissionControls } from "../MissionControls.js";

const SESSION = "00000000-0000-4000-8000-0000000000d1";
const MISSION = "mission-1";

function ok<T>(data: T) {
  return { ok: true as const, data };
}

const getStateMock = vi.fn();
const getDraftMock = vi.fn();
const getDiffMock = vi.fn();
const getRenewableMock = vi.fn();
const startMock = vi.fn();
const continueMock = vi.fn();
const retryMock = vi.fn();
const editMock = vi.fn();
const stopMock = vi.fn();
const renewMock = vi.fn();

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      runtime: { getState: getStateMock },
      mission: {
        getDraft: getDraftMock,
        getDiff: getDiffMock,
        getRenewableSource: getRenewableMock,
        start: startMock,
        continue: continueMock,
        retry: retryMock,
        edit: editMock,
        stop: stopMock,
        renew: renewMock,
      },
    },
  });
}

function runtimeState(over: Record<string, unknown>) {
  return ok({
    sessionId: SESSION,
    hasActiveRun: false,
    missionRunId: null,
    status: null,
    stopReason: null,
    lastCheckpointAt: null,
    startedAt: null,
    iterationCount: null,
    leaseActive: false,
    leaseExpiresAt: null,
    pendingControlKind: null,
    ...over,
  });
}

function draftReady() {
  return ok({ missionId: MISSION, status: "ready" });
}

function diffAccepted(isAccepted: boolean, isDirty = false) {
  return ok({
    outcome: "ready",
    isAccepted,
    isDirty,
    currentHash: "h".repeat(64),
  });
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function Wrapper({ children }: { readonly children: ReactNode }) {
  return createElement(QueryClientProvider, { client: freshClient() }, children);
}

function renderControls() {
  setVex();
  return render(createElement(MissionControls, { sessionId: SESSION }), {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  // Default: no renewable source. The hook fires for every render (active or
  // not), so give it a safe value; renew-specific tests override it.
  getRenewableMock.mockResolvedValue(ok(null));
});

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("MissionControls", () => {
  it("shows Start (and dispatches mission.start) for a ready+accepted contract with no active run", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    startMock.mockResolvedValue(
      ok({ outcome: "dispatched", missionRunId: "r1", sessionId: SESSION }),
    );
    renderControls();

    const startBtn = await screen.findByRole("button", { name: "Start mission" });
    // Accepted-clean contract → the acceptance-pending notice must be gone
    // (the Start CTA is the deterministic signal from here).
    expect(screen.queryByText(/Mission contract not accepted/i)).toBeNull();
    fireEvent.click(startBtn);
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    expect(startMock).toHaveBeenCalledWith({ sessionId: SESSION, missionId: MISSION });
  });

  it("does not show Start when the contract is not accepted", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(false));
    renderControls();

    await waitFor(() => expect(getDiffMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Start mission" })).toBeNull();
    // Standing acceptance-pending notice: the runtime gate blocks every
    // on-chain broadcast pre-acceptance, and the user must SEE that.
    await screen.findByText(/on-chain actions .* are blocked until you accept/i);
  });

  it("shows the standing acceptance-pending notice while the draft is still in setup", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok({ missionId: MISSION, status: "draft" }));
    getDiffMock.mockResolvedValue(diffAccepted(false));
    renderControls();

    await screen.findByText(/Mission contract not accepted/i);
    expect(screen.queryByRole("button", { name: "Start mission" })).toBeNull();
  });

  it("running: Stop + Edit enabled, Continue + Recover disabled", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({ hasActiveRun: true, status: "running", missionRunId: "r1" }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    renderControls();

    const stopBtn = await screen.findByRole("button", { name: "Stop mission" });
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Edit mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Continue mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Recover mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("paused_error: Recover enabled (dispatches mission.retry), Continue disabled", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({ hasActiveRun: true, status: "paused_error", missionRunId: "r1" }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    retryMock.mockResolvedValue(ok({ outcome: "resumed", runId: "r1" }));
    renderControls();

    const recoverBtn = await screen.findByRole("button", { name: "Recover mission" });
    expect((recoverBtn as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Continue mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(recoverBtn);
    await waitFor(() => expect(retryMock).toHaveBeenCalledWith({ sessionId: SESSION }));
  });

  it("paused_wake: Continue enabled (dispatches mission.continue)", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({ hasActiveRun: true, status: "paused_wake", missionRunId: "r1" }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    continueMock.mockResolvedValue(ok({ outcome: "resumed", runId: "r1" }));
    renderControls();

    const continueBtn = await screen.findByRole("button", { name: "Continue mission" });
    expect((continueBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(continueBtn);
    await waitFor(() =>
      expect(continueMock).toHaveBeenCalledWith({ sessionId: SESSION }),
    );
  });

  it("paused_approval: Edit is disabled", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_approval",
        missionRunId: "r1",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    renderControls();

    await screen.findByRole("button", { name: "Stop mission" });
    expect(
      (screen.getByRole("button", { name: "Edit mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables every control while a control request is already pending", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_wake",
        missionRunId: "r1",
        pendingControlKind: "resume",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    renderControls();

    const continueBtn = await screen.findByRole("button", { name: "Continue mission" });
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Stop mission" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("surfaces a refusal outcome (Start not_accepted → notice)", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    startMock.mockResolvedValue(ok({ outcome: "not_accepted", missionId: MISSION }));
    renderControls();

    const startBtn = await screen.findByRole("button", { name: "Start mission" });
    fireEvent.click(startBtn);
    await screen.findByText(/Accept the contract before starting/i);
  });

  it("renders the active-run toolbar even when getDraft is null (mission row is past 'ready' mid-run)", async () => {
    // Reality: a started mission's row is flipped to running/terminal, so
    // getDraft returns null for the whole active run. The toolbar must key off
    // runtime alone — this pins the gate fix.
    getStateMock.mockResolvedValue(
      runtimeState({ hasActiveRun: true, status: "paused_error", missionRunId: "r1" }),
    );
    getDraftMock.mockResolvedValue(ok(null));
    renderControls();

    const recoverBtn = await screen.findByRole("button", { name: "Recover mission" });
    expect((recoverBtn as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Stop mission" }),
    ).toBeTruthy();
  });

  it("no active run + renew source (no startable draft) → Renew dispatches mission.renew", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok(null));
    getRenewableMock.mockResolvedValue(ok({ missionId: "m-done" }));
    renewMock.mockResolvedValue(
      ok({ outcome: "renewed", newMissionId: "m-new", sourceMissionId: "m-done" }),
    );
    renderControls();

    const renewBtn = await screen.findByRole("button", { name: "Renew mission" });
    fireEvent.click(renewBtn);
    await waitFor(() =>
      expect(renewMock).toHaveBeenCalledWith({
        sessionId: SESSION,
        previousMissionId: "m-done",
      }),
    );
  });

  it("Start wins over Renew when an accepted ready draft exists", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    getRenewableMock.mockResolvedValue(ok({ missionId: "m-done" }));
    renderControls();

    await screen.findByRole("button", { name: "Start mission" });
    expect(screen.queryByRole("button", { name: "Renew mission" })).toBeNull();
  });

  it("hides Renew once a fresh draft exists (post-renew) — no duplicate-draft loop", async () => {
    // After mission.renew, a fresh status='draft' mission exists, but
    // getRenewableSource STILL returns the old terminal accepted mission. Renew
    // must NOT linger — else it looks like it "did nothing" and each extra click
    // clones another duplicate draft. The fresh draft's acceptance UI wins.
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok({ missionId: MISSION, status: "draft" }));
    getDiffMock.mockResolvedValue(diffAccepted(false));
    getRenewableMock.mockResolvedValue(ok({ missionId: "m-done" }));
    renderControls();

    await screen.findByText(/Mission contract not accepted/i);
    expect(screen.queryByRole("button", { name: "Renew mission" })).toBeNull();
  });

  it("surfaces a renew refusal (not_terminal_yet → notice)", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok(null));
    getRenewableMock.mockResolvedValue(ok({ missionId: "m-done" }));
    renewMock.mockResolvedValue(
      ok({
        outcome: "not_terminal_yet",
        sourceMissionId: "m-done",
        missionRunId: "r1",
        runStatus: "running",
      }),
    );
    renderControls();

    const renewBtn = await screen.findByRole("button", { name: "Renew mission" });
    fireEvent.click(renewBtn);
    await screen.findByText(/isn't finished yet/i);
  });

  it("surfaces a renew refusal (session_has_pending_draft → notice, WP-D transactional close)", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok(null));
    getRenewableMock.mockResolvedValue(ok({ missionId: "m-done" }));
    renewMock.mockResolvedValue(
      ok({
        outcome: "session_has_pending_draft",
        missionId: "m-pending-draft",
      }),
    );
    renderControls();

    const renewBtn = await screen.findByRole("button", { name: "Renew mission" });
    fireEvent.click(renewBtn);
    await screen.findByText(/draft mission already exists/i);
  });

  it("no active run, no startable draft, no renew source → renders nothing", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok(null));
    getRenewableMock.mockResolvedValue(ok(null));
    renderControls();

    await waitFor(() => expect(getRenewableMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Start mission" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renew mission" })).toBeNull();
  });
});

describe("MissionControls — paused_error standing alert (issue #42)", () => {
  it("renders the alert with the eyebrow, provider_error copy, and the warning line", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_error",
        missionRunId: "r1",
        stopReason: "provider_error",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    renderControls();

    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-vex-area")).toBe("mission-error-alert");
    expect(alert.textContent).toMatch(/Mission paused — error/i);
    expect(alert.textContent).toMatch(
      /The mission paused after an inference or runtime error\./,
    );
    expect(alert.textContent).toMatch(
      /The mission is not monitoring the market or your positions until you recover it\./,
    );
  });

  it("falls back to generic copy for a non-provider_error stopReason", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_error",
        missionRunId: "r1",
        stopReason: "unexpected_exception",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    renderControls();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /The mission paused after an unexpected error\./,
    );
    expect(alert.textContent).not.toMatch(/inference or runtime error/);
  });

  it("does not render the alert for running / paused_wake / paused_approval", async () => {
    const activeCases = [
      { hasActiveRun: true, status: "running", missionRunId: "r1" },
      { hasActiveRun: true, status: "paused_wake", missionRunId: "r1" },
      { hasActiveRun: true, status: "paused_approval", missionRunId: "r1" },
    ];
    for (const over of activeCases) {
      getStateMock.mockResolvedValue(runtimeState(over));
      getDraftMock.mockResolvedValue(draftReady());
      getDiffMock.mockResolvedValue(diffAccepted(true));
      const { unmount } = renderControls();
      await screen.findByRole("group", { name: "Mission controls" });
      expect(
        document.querySelector('[data-vex-area="mission-error-alert"]'),
      ).toBeNull();
      unmount();
    }
  });

  it("does not render the alert when there is no active run", async () => {
    getStateMock.mockResolvedValue(runtimeState({ hasActiveRun: false }));
    getDraftMock.mockResolvedValue(ok(null));
    getRenewableMock.mockResolvedValue(ok(null));
    renderControls();

    await waitFor(() => expect(getRenewableMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(
      document.querySelector('[data-vex-area="mission-error-alert"]'),
    ).toBeNull();
  });

  it("shows a visible 'Recovering…' label while pending but keeps the accessible name stable, with aria-busy set", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_error",
        missionRunId: "r1",
        stopReason: "provider_error",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    let resolveRetry: (value: unknown) => void = () => {};
    retryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );
    renderControls();

    const recoverBtn = await screen.findByRole("button", {
      name: "Recover mission",
    });
    fireEvent.click(recoverBtn);

    await waitFor(() => expect(recoverBtn.textContent).toBe("Recovering…"));
    expect(recoverBtn.getAttribute("aria-label")).toBe("Recover mission");
    expect(recoverBtn.getAttribute("aria-busy")).toBe("true");
    // Accessible name (role+name query) stays stable while the visible label
    // changes — the same element is found by its stable name.
    expect(
      screen.getByRole("button", { name: "Recover mission" }),
    ).toBe(recoverBtn);

    resolveRetry(ok({ outcome: "resumed", runId: "r1" }));
    await waitFor(() => expect(recoverBtn.textContent).toBe("Recover"));
    expect(recoverBtn.getAttribute("aria-busy")).toBe("false");
  });

  it("persists the alert when a recover mutation settles and the refetched state is still paused_error", async () => {
    getStateMock.mockResolvedValue(
      runtimeState({
        hasActiveRun: true,
        status: "paused_error",
        missionRunId: "r1",
        stopReason: "provider_error",
      }),
    );
    getDraftMock.mockResolvedValue(draftReady());
    getDiffMock.mockResolvedValue(diffAccepted(true));
    // The mutation itself reports success, but the mission re-parks (or the
    // recovery never actually cleared the pause) — the refetched runtime
    // state getState keeps returning is still paused_error throughout.
    retryMock.mockResolvedValue(ok({ outcome: "resumed", runId: "r1" }));
    renderControls();

    const recoverBtn = await screen.findByRole("button", {
      name: "Recover mission",
    });
    await screen.findByRole("alert");
    fireEvent.click(recoverBtn);

    await waitFor(() => expect(retryMock).toHaveBeenCalledTimes(1));
    // No failure notice (the mutation "succeeded"), yet the standing alert is
    // state-driven off runtime.status — it stays visible because the
    // refetched status is still paused_error.
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      document.querySelector('[data-vex-area="mission-error-alert"]'),
    ).not.toBeNull();
  });
});
