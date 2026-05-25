/**
 * Slash command dispatcher hook tests (puzzle 04 phase 7).
 *
 * Covers:
 *   - every command routes to the matching mission bridge method,
 *   - `/mission-start` blocks when no current missionId is available,
 *   - `/mission-renew` resolves `previousMissionId` via
 *     `mission.getRenewableSource` and blocks when null
 *     (codex phase 7 review #3),
 *   - `/restore` mints a fresh `crypto.randomUUID()` per dispatch,
 *   - `/mission-edit` surfaces `outcome: "unavailable"` as a friendly
 *     SUCCESS notice (codex phase 7 /mission edit correction).
 *   - Per-command outcome mapping: an `ok` Result with an engine
 *     refusal outcome (`not_accepted`, `no_active_run`, etc.) MUST
 *     surface as `blocked`, NOT a misleading success notice (codex
 *     phase 7 final review #1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import {
  useSlashCommandDispatch,
  type SlashDispatchContext,
} from "../slash/dispatch.js";
import type { DispatchOutcome, SlashCommand } from "../slash/types.js";

const SESSION = "00000000-0000-4000-8000-000000000aaa";
const MISSION = "mission-current";

const mockBridge = {
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
  stop: vi.fn(),
  getRenewableSource: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { mission: mockBridge },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "vex");
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

async function runDispatch(
  command: SlashCommand,
  ctx: SlashDispatchContext = { sessionId: SESSION, missionId: null },
): Promise<DispatchOutcome | null> {
  const { result } = renderHook(() => useSlashCommandDispatch(ctx), {
    wrapper: makeWrapper(makeClient()),
  });
  let outcome: DispatchOutcome | null = null;
  await act(async () => {
    outcome = await result.current.dispatch(command);
  });
  return outcome;
}

describe("useSlashCommandDispatch routing", () => {
  it("dispatches /mission start with the current missionId (dispatched → success)", async () => {
    mockBridge.start.mockResolvedValue({
      ok: true,
      data: { outcome: "dispatched", missionRunId: "run-1", sessionId: SESSION },
    });
    const outcome = await runDispatch(
      { kind: "mission-start" },
      { sessionId: SESSION, missionId: MISSION },
    );
    expect(outcome?.kind).toBe("success");
    expect(mockBridge.start).toHaveBeenCalledWith({
      sessionId: SESSION,
      missionId: MISSION,
    });
  });

  it("BLOCKS /mission start when no current missionId is resolved", async () => {
    const outcome = await runDispatch({ kind: "mission-start" });
    expect(outcome?.kind).toBe("blocked");
    expect(mockBridge.start).not.toHaveBeenCalled();
  });

  it("dispatches /retry as continue alias", async () => {
    mockBridge.continue.mockResolvedValue({
      ok: true,
      data: { outcome: "resumed", runId: "run-1" },
    });
    await runDispatch({ kind: "mission-continue" });
    await runDispatch({ kind: "retry" });
    expect(mockBridge.continue).toHaveBeenCalledTimes(2);
    expect(mockBridge.continue).toHaveBeenCalledWith({ sessionId: SESSION });
  });

  it("dispatches /mission recover (dispatched → success)", async () => {
    mockBridge.recover.mockResolvedValue({
      ok: true,
      data: {
        outcome: "dispatched",
        missionRunId: "run-2",
        recoveredFromRunId: "run-1",
      },
    });
    const outcome = await runDispatch({ kind: "mission-recover" });
    expect(outcome?.kind).toBe("success");
  });

  it("dispatches /rewind with rewound outcome + turn count in message", async () => {
    mockBridge.rewind.mockResolvedValue({
      ok: true,
      data: {
        outcome: "rewound",
        archivedMessages: 8,
        cutoffMessageId: 42,
        checkpointId: "chk-1",
        rejectedApprovals: 0,
        cancelledWakes: 0,
        missionRunImpact: "none",
      },
    });
    const outcome = await runDispatch({ kind: "rewind", turns: 5 });
    expect(outcome?.kind).toBe("success");
    expect(outcome?.message).toMatch(/Rewound 5 user turns/);
    expect(mockBridge.rewind).toHaveBeenCalledWith({
      sessionId: SESSION,
      turns: 5,
    });
  });

  it("dispatches /restore with a fresh UUID per attempt", async () => {
    mockBridge.restore.mockResolvedValue({
      ok: true,
      data: { outcome: "no_checkpoint" },
    });
    await runDispatch({ kind: "restore" });
    await runDispatch({ kind: "restore" });
    expect(mockBridge.restore).toHaveBeenCalledTimes(2);
    const k1 = (mockBridge.restore.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey;
    const k2 = (mockBridge.restore.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey;
    expect(k1).not.toBe(k2);
    expect(k1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("BLOCKS /mission-renew when the renewable source resolver returns null", async () => {
    mockBridge.getRenewableSource.mockResolvedValue({ ok: true, data: null });
    const outcome = await runDispatch({ kind: "mission-renew" });
    expect(mockBridge.getRenewableSource).toHaveBeenCalledWith({
      sessionId: SESSION,
    });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/No completed mission/);
    expect(mockBridge.renew).not.toHaveBeenCalled();
  });

  it("dispatches /mission-renew with resolved previousMissionId when source exists", async () => {
    mockBridge.getRenewableSource.mockResolvedValue({
      ok: true,
      data: { missionId: "mission-source" },
    });
    mockBridge.renew.mockResolvedValue({
      ok: true,
      data: {
        outcome: "renewed",
        newMissionId: "mission-new",
        sourceMissionId: "mission-source",
      },
    });
    const outcome = await runDispatch({ kind: "mission-renew" });
    expect(outcome?.kind).toBe("success");
    expect(mockBridge.renew).toHaveBeenCalledWith({
      sessionId: SESSION,
      previousMissionId: "mission-source",
    });
  });

  it("surfaces /mission edit `unavailable` outcome as SUCCESS (not error)", async () => {
    mockBridge.updateDraft.mockResolvedValue({
      ok: true,
      data: { outcome: "unavailable" },
    });
    const outcome = await runDispatch({ kind: "mission-edit" });
    expect(outcome?.kind).toBe("success");
    expect(outcome?.message).toMatch(/coming soon/i);
  });

  it("surfaces bridge errors as DispatchOutcome.error with the engine message", async () => {
    mockBridge.start.mockResolvedValue({
      ok: false,
      error: {
        code: "validation.invalid_input",
        domain: "mission",
        message: "Mission not ready: missing goal.",
        retryable: false,
        userActionable: true,
        redacted: false,
      },
    });
    const outcome = await runDispatch(
      { kind: "mission-start" },
      { sessionId: SESSION, missionId: MISSION },
    );
    expect(outcome?.kind).toBe("error");
    expect(outcome?.message).toBe("Mission not ready: missing goal.");
  });
});

describe("refusal outcomes", () => {
  // Engine returns `ok: true` with an outcome that means "I refused".
  // The dispatcher must NOT surface these as successes.

  it("maps /mission start `not_accepted` to BLOCKED", async () => {
    mockBridge.start.mockResolvedValue({
      ok: true,
      data: { outcome: "not_accepted", missionId: MISSION },
    });
    const outcome = await runDispatch(
      { kind: "mission-start" },
      { sessionId: SESSION, missionId: MISSION },
    );
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/Accept the contract first/i);
  });

  it("maps /mission continue `no_active_run` to BLOCKED", async () => {
    mockBridge.continue.mockResolvedValue({
      ok: true,
      data: { outcome: "no_active_run" },
    });
    const outcome = await runDispatch({ kind: "mission-continue" });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/No active mission run/i);
  });

  it("maps /restore `no_checkpoint` to BLOCKED", async () => {
    mockBridge.restore.mockResolvedValue({
      ok: true,
      data: { outcome: "no_checkpoint" },
    });
    const outcome = await runDispatch({ kind: "restore" });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/No rewind checkpoint/i);
  });

  it("maps /rewind `blocked_active_run` to BLOCKED with the engine reason", async () => {
    mockBridge.rewind.mockResolvedValue({
      ok: true,
      data: {
        outcome: "blocked_active_run",
        reason: "Cannot rewind while a mission run is running.",
      },
    });
    const outcome = await runDispatch({ kind: "rewind", turns: 3 });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/Cannot rewind while/i);
  });

  it("maps /mission-renew `not_terminal_yet` to BLOCKED", async () => {
    mockBridge.getRenewableSource.mockResolvedValue({
      ok: true,
      data: { missionId: "mission-source" },
    });
    mockBridge.renew.mockResolvedValue({
      ok: true,
      data: {
        outcome: "not_terminal_yet",
        sourceMissionId: "mission-source",
        missionRunId: "run-active",
        runStatus: "running",
      },
    });
    const outcome = await runDispatch({ kind: "mission-renew" });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/isn't finished yet/i);
  });

  it("maps /mission stop `no_active_run` to BLOCKED", async () => {
    mockBridge.stop.mockResolvedValue({
      ok: true,
      data: { outcome: "no_active_run" },
    });
    const outcome = await runDispatch({ kind: "mission-stop" });
    expect(outcome?.kind).toBe("blocked");
    expect(outcome?.message).toMatch(/No active mission run/i);
  });
});
