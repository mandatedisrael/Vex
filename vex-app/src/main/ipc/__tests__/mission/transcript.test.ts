/**
 * Mission transcript-control handler tests (puzzle 04 phase 6) —
 * `rewind`, `restore`, `renew`.
 *
 * Codex-required cases:
 *   - rewind `Cannot rewind` throw → `blocked_active_run`
 *   - restore `lease_busy` strips internal ownerId
 *   - schema validation rejects out-of-range rewind turns
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { CH } from "@shared/ipc/channels.js";
import {
  createTestWebContents,
  createTrustedSender,
} from "../test-sender.js";

const mockRewindSession = vi.fn();
const mockRestoreLatestCheckpoint = vi.fn();
const mockRenewMission = vi.fn();
const mockEnsureEngineDbUrl = vi.fn();
const mockEmitControlStateAfterChange = vi.fn();
const mockGetRenewableSourceForSession = vi.fn();

vi.mock("electron", () => {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn(
        (
          channel: string,
          fn: (e: IpcMainInvokeEvent, p: unknown) => unknown,
        ) => handlers.set(channel, fn),
      ),
      removeHandler: vi.fn((ch: string) => handlers.delete(ch)),
    },
    __handlers: handlers,
  };
});

vi.mock("@vex-agent/engine/core/rewind.js", () => ({
  rewindSession: (...a: unknown[]) => mockRewindSession(...a),
}));

vi.mock("@vex-agent/engine/mission/restore.js", () => ({
  restoreLatestCheckpoint: (...a: unknown[]) =>
    mockRestoreLatestCheckpoint(...a),
}));

vi.mock("@vex-agent/engine/mission/renew.js", () => ({
  renewMission: (...a: unknown[]) => mockRenewMission(...a),
}));

vi.mock("../../../database/missions-db.js", () => ({
  // `get-draft.ts` uses getDraftForSession; transcript suite doesn't
  // call it, but the import must exist so the module evaluates.
  getDraftForSession: vi.fn().mockResolvedValue({ ok: true, data: null }),
  getRenewableSourceForSession: (...a: unknown[]) =>
    mockGetRenewableSourceForSession(...a),
}));

vi.mock("../../runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: (...a: unknown[]) => mockEnsureEngineDbUrl(...a),
}));

vi.mock("../../runtime/_emit-control-state.js", () => ({
  emitControlStateAfterChange: (...a: unknown[]) =>
    mockEmitControlStateAfterChange(...a),
}));

vi.mock("../../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { registerMissionHandlers } = await import("../../mission.js");
const electronMock = (await import("electron")) as unknown as {
  __handlers: Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>;
};

const SESSION = "00000000-0000-4000-8000-00000000aaaa";
const MISSION = "mission-1";

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

async function call(channel: string, payload: unknown) {
  const handler = electronMock.__handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return (await handler(
    trustedSender as unknown as IpcMainInvokeEvent,
    {
      requestId: "11111111-1111-4111-8111-111111111111",
      payload,
    },
  )) as { ok: boolean; data?: unknown; error?: { code: string } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsureEngineDbUrl.mockResolvedValue({ ok: true, data: undefined });
  mockEmitControlStateAfterChange.mockResolvedValue(undefined);
  electronMock.__handlers.clear();
  registerMissionHandlers();
});

describe("mission.rewind", () => {
  it("maps the engine `rewound` outcome including the checkpoint id", async () => {
    mockRewindSession.mockResolvedValueOnce({
      archivedMessages: 4,
      rejectedApprovals: 1,
      cancelledWakes: 0,
      cutoffMessageId: 42,
      checkpointId: "chk-1",
      missionRunImpact: "stopped",
      noop: false,
    });
    const result = await call(CH.mission.rewind, {
      sessionId: SESSION,
      turns: 1,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      outcome: "rewound",
      archivedMessages: 4,
      cutoffMessageId: 42,
      checkpointId: "chk-1",
      rejectedApprovals: 1,
      cancelledWakes: 0,
      missionRunImpact: "stopped",
    });
  });

  it("catches `Cannot rewind` throw and maps to blocked_active_run", async () => {
    mockRewindSession.mockRejectedValueOnce(
      new Error("Cannot rewind while a mission run is running."),
    );
    const result = await call(CH.mission.rewind, {
      sessionId: SESSION,
      turns: 1,
    });
    expect(result.ok).toBe(true);
    expect((result.data as { outcome: string }).outcome).toBe(
      "blocked_active_run",
    );
  });

  it("rejects out-of-range turns via schema validation", async () => {
    const result = await call(CH.mission.rewind, {
      sessionId: SESSION,
      turns: 51,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });
});

describe("mission.restore", () => {
  it("strips lease ownerId from `lease_busy` outcome", async () => {
    const expires = new Date(Date.now() + 30_000);
    mockRestoreLatestCheckpoint.mockResolvedValueOnce({
      outcome: "lease_busy",
      currentLease: {
        sessionId: SESSION,
        missionRunId: null,
        ownerId: "secret-owner-id",
        processKind: "electron_main",
        acquiredAt: new Date(),
        heartbeatAt: new Date(),
        expiresAt: expires,
      },
    });
    const result = await call(CH.mission.restore, {
      sessionId: SESSION,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.ok).toBe(true);
    const data = result.data as { outcome: string; retryAfterMs?: number };
    expect(data.outcome).toBe("lease_busy");
    expect(JSON.stringify(data)).not.toContain("secret-owner-id");
    expect(typeof data.retryAfterMs).toBe("number");
  });

  it("passes the `restored` outcome through with restoredCount", async () => {
    mockRestoreLatestCheckpoint.mockResolvedValueOnce({
      outcome: "restored",
      checkpointId: "chk-1",
      restoredAt: "2026-05-22T10:00:00.000Z",
      restoredCount: 5,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    const result = await call(CH.mission.restore, {
      sessionId: SESSION,
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      outcome: "restored",
      restoredCount: 5,
      checkpointId: "chk-1",
    });
  });
});

describe("mission.renew", () => {
  it("forwards the `renewed` outcome with new mission id", async () => {
    mockRenewMission.mockResolvedValueOnce({
      outcome: "renewed",
      newMissionId: "mission-2",
      sourceMissionId: MISSION,
    });
    const result = await call(CH.mission.renew, {
      sessionId: SESSION,
      previousMissionId: MISSION,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      outcome: "renewed",
      newMissionId: "mission-2",
    });
  });
});

describe("mission.getRenewableSource", () => {
  it("returns the resolved missionId from the DB helper", async () => {
    mockGetRenewableSourceForSession.mockResolvedValueOnce({
      ok: true,
      data: { missionId: "mission-finished" },
    });
    const result = await call(CH.mission.getRenewableSource, {
      sessionId: SESSION,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ missionId: "mission-finished" });
    expect(mockGetRenewableSourceForSession).toHaveBeenCalledWith(SESSION);
  });

  it("returns null when no terminal accepted mission exists", async () => {
    mockGetRenewableSourceForSession.mockResolvedValueOnce({
      ok: true,
      data: null,
    });
    const result = await call(CH.mission.getRenewableSource, {
      sessionId: SESSION,
    });
    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("rejects malformed input via schema (non-uuid sessionId)", async () => {
    const result = await call(CH.mission.getRenewableSource, {
      sessionId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockGetRenewableSourceForSession).not.toHaveBeenCalled();
  });

  it("passes a DB error through with the error result shape", async () => {
    mockGetRenewableSourceForSession.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "mission",
        message: "Unable to resolve renewable mission source.",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const result = await call(CH.mission.getRenewableSource, {
      sessionId: SESSION,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal.unexpected");
  });
});
