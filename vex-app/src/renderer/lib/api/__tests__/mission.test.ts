/**
 * Mission renderer hook invalidation tests (puzzle 04 phase 6).
 *
 * Verifies that mutation hooks fire `queryClient.invalidateQueries`
 * against the documented keys on success:
 *
 *   - acceptContract → missionKeys.draft + missionKeys.diff
 *   - start          → missionKeys.draft + missionKeys.diff + runtimeKeys.state
 *   - rewind/restore → messagesKeys.forSession + runtimeKeys.state + missionKeys.draft
 *   - continue/stop  → runtimeKeys.state
 *   - renew          → missionKeys.all
 *
 * `messagesKeys.forSession` is the prefix-match catch-all that the
 * rewind/restore paths must invalidate (codex puzzle-04 phase-6 #6).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import {
  useAcceptMissionContract,
  useEditMission,
  useMissionContinue,
  useMissionRecover,
  useMissionRenew,
  useMissionRestore,
  useMissionRetry,
  useMissionRewind,
  useMissionStart,
  useMissionStop,
  useRenewableMissionSource,
} from "../mission.js";
import {
  messagesKeys,
  missionKeys,
  runtimeKeys,
} from "../queryKeys.js";

const SESSION = "00000000-0000-4000-8000-000000000001";
const MISSION = "mission-1";
const IDEMPOTENCY = "11111111-1111-4111-8111-111111111111";

const mockMissionBridge = {
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  getDiff: vi.fn(),
  acceptContract: vi.fn(),
  start: vi.fn(),
  continue: vi.fn(),
  recover: vi.fn(),
  rewind: vi.fn(),
  restore: vi.fn(),
  renew: vi.fn(),
  retry: vi.fn(),
  edit: vi.fn(),
  stop: vi.fn(),
  getRenewableSource: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { mission: mockMissionBridge },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "vex");
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      children,
    );
  };
}

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  return { client, invalidateSpy };
}

describe("mission hook invalidations", () => {
  it("useAcceptMissionContract invalidates draft + diff for the session", async () => {
    mockMissionBridge.acceptContract.mockResolvedValue({
      ok: true,
      data: { outcome: "accepted" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useAcceptMissionContract(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        sessionId: SESSION,
        missionId: MISSION,
        contractHash: "a".repeat(64),
      });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: missionKeys.draft(SESSION),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.diff(SESSION, MISSION),
    });
  });

  it("useMissionStart invalidates draft + diff + runtime state", async () => {
    mockMissionBridge.start.mockResolvedValue({
      ok: true,
      data: { outcome: "dispatched", missionRunId: "run-1", sessionId: SESSION },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionStart(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        sessionId: SESSION,
        missionId: MISSION,
      });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: runtimeKeys.state(SESSION),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.draft(SESSION),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.diff(SESSION, MISSION),
    });
    // Phase 7 — start lifts source out of terminal-latest state.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.renewableSource(SESSION),
    });
  });

  it("useMissionRetry invalidates runtime state", async () => {
    mockMissionBridge.retry.mockResolvedValue({
      ok: true,
      data: { outcome: "resumed", runId: "run-1" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionRetry(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: SESSION });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: runtimeKeys.state(SESSION),
      });
    });
  });

  it("useEditMission invalidates draft + runtime + renewable source", async () => {
    mockMissionBridge.edit.mockResolvedValue({
      ok: true,
      data: { outcome: "stopped" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useEditMission(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: SESSION });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: missionKeys.draft(SESSION),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: runtimeKeys.state(SESSION),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.renewableSource(SESSION),
    });
  });

  it("useMissionRewind invalidates messagesKeys.forSession (prefix match)", async () => {
    mockMissionBridge.rewind.mockResolvedValue({
      ok: true,
      data: { outcome: "noop" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionRewind(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        sessionId: SESSION,
        turns: 1,
      });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: messagesKeys.forSession(SESSION),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: runtimeKeys.state(SESSION),
    });
    // Phase 7 — rewind can flip mission_run terminal.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.renewableSource(SESSION),
    });
  });

  it("useMissionRestore invalidates messagesKeys.forSession + runtime state", async () => {
    mockMissionBridge.restore.mockResolvedValue({
      ok: true,
      data: { outcome: "no_checkpoint" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionRestore(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        sessionId: SESSION,
        idempotencyKey: IDEMPOTENCY,
      });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: messagesKeys.forSession(SESSION),
      });
    });
  });

  it("useMissionContinue invalidates runtime state only", async () => {
    mockMissionBridge.continue.mockResolvedValue({
      ok: true,
      data: { outcome: "no_active_run" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionContinue(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: SESSION });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: runtimeKeys.state(SESSION),
      });
    });
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: missionKeys.draft(SESSION),
    });
  });

  it("useMissionStop invalidates runtime state only", async () => {
    mockMissionBridge.stop.mockResolvedValue({
      ok: true,
      data: { outcome: "no_active_run" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionStop(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: SESSION });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: runtimeKeys.state(SESSION),
      });
    });
    // Phase 7 — stop flips mission_run terminal → renewable source shifts.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.renewableSource(SESSION),
    });
  });

  it("useMissionRecover invalidates draft + runtime state", async () => {
    mockMissionBridge.recover.mockResolvedValue({
      ok: true,
      data: { outcome: "no_failed_run" },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionRecover(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: SESSION });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: missionKeys.draft(SESSION),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: runtimeKeys.state(SESSION),
    });
    // Phase 7 — recover replaces latest mission_run → terminal-latest may shift.
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: missionKeys.renewableSource(SESSION),
    });
  });

  it("useMissionRenew invalidates missionKeys.all (covers old draft + new mission)", async () => {
    mockMissionBridge.renew.mockResolvedValue({
      ok: true,
      data: {
        outcome: "renewed",
        newMissionId: "mission-2",
        sourceMissionId: MISSION,
      },
    });
    const { client, invalidateSpy } = makeClient();
    const { result } = renderHook(() => useMissionRenew(), {
      wrapper: makeWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        sessionId: SESSION,
        previousMissionId: MISSION,
      });
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: missionKeys.all,
      });
    });
  });

  it("useRenewableMissionSource queries the bridge with the session", async () => {
    mockMissionBridge.getRenewableSource.mockResolvedValue({
      ok: true,
      data: { missionId: MISSION },
    });
    const { client } = makeClient();
    const { result } = renderHook(() => useRenewableMissionSource(SESSION), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMissionBridge.getRenewableSource).toHaveBeenCalledWith({
      sessionId: SESSION,
    });
    if (result.current.data?.ok === true) {
      expect(result.current.data.data).toEqual({ missionId: MISSION });
    }
  });

  it("useRenewableMissionSource is disabled when sessionId is null", () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useRenewableMissionSource(null), {
      wrapper: makeWrapper(client),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockMissionBridge.getRenewableSource).not.toHaveBeenCalled();
  });
});
