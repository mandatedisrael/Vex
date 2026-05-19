import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "./test-sender.js";
import type { SessionListItem } from "@shared/schemas/sessions.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const mocks = vi.hoisted(() => ({
  getSessionById: vi.fn(),
  setInitialMissionGoalIfUnset: vi.fn(),
  buildPoolConfig: vi.fn(),
  closePool: vi.fn(),
  submitOperatorInstruction: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { isPackaged: true },
}));

vi.mock("../../database/sessions-db.js", () => ({
  getSessionById: mocks.getSessionById,
  setInitialMissionGoalIfUnset: mocks.setInitialMissionGoalIfUnset,
}));

vi.mock("../../database/db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("@vex-agent/db/client.js", () => ({
  closePool: mocks.closePool,
}));

vi.mock("@vex-agent/engine/index.js", () => ({
  submitOperatorInstruction: mocks.submitOperatorInstruction,
}));

vi.mock("../../logger/index.js", () => ({
  log: mocks.log,
}));

const { registerChatSubmitHandler } = await import("../chat.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });
const previousDbUrl = process.env.VEX_DB_URL;

function restoreDbUrl(): void {
  if (previousDbUrl === undefined) {
    delete process.env.VEX_DB_URL;
    return;
  }
  process.env.VEX_DB_URL = previousDbUrl;
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  restoreDbUrl();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "test-secret",
  });
  mocks.submitOperatorInstruction.mockResolvedValue({
    text: null,
    toolCallsMade: 0,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: "draft",
  });
});

afterEach(() => {
  handlers.clear();
  restoreDbUrl();
});

describe("registerChatSubmitHandler", () => {
  it("stores the first mission message as initial goal before engine routing", async () => {
    const row = makeSessionRow({ mode: "mission", initialGoal: null });
    mocks.getSessionById.mockResolvedValue({ ok: true, data: row });
    mocks.setInitialMissionGoalIfUnset.mockResolvedValue({ ok: true, data: true });
    registerChatSubmitHandler();

    const fn = handlers.get(CH.chat.submit)!;
    const result = (await fn(trustedSender, {
      requestId: "r1",
      payload: {
        sessionId: row.id,
        message: "  Rebalance Arbitrum LP  ",
      },
    })) as { ok: boolean; data?: { treatedAsInitialGoal: boolean } };

    expect(result.ok).toBe(true);
    expect(result.data?.treatedAsInitialGoal).toBe(true);
    expect(mocks.setInitialMissionGoalIfUnset).toHaveBeenCalledWith(
      row.id,
      "Rebalance Arbitrum LP",
    );
    expect(mocks.submitOperatorInstruction).toHaveBeenCalledWith(
      row.id,
      "Rebalance Arbitrum LP",
    );
    expect(process.env.VEX_DB_URL).toBe(
      "postgresql://vex:test-secret@127.0.0.1:5777/vex",
    );
  });

  it("does not touch initial goal for agent sessions", async () => {
    const row = makeSessionRow({ mode: "agent", initialGoal: null });
    mocks.getSessionById.mockResolvedValue({ ok: true, data: row });
    registerChatSubmitHandler();

    const fn = handlers.get(CH.chat.submit)!;
    const result = (await fn(trustedSender, {
      requestId: "r2",
      payload: {
        sessionId: row.id,
        message: "Check portfolio",
      },
    })) as { ok: boolean; data?: { treatedAsInitialGoal: boolean } };

    expect(result.ok).toBe(true);
    expect(result.data?.treatedAsInitialGoal).toBe(false);
    expect(mocks.setInitialMissionGoalIfUnset).not.toHaveBeenCalled();
    expect(mocks.submitOperatorInstruction).toHaveBeenCalledWith(
      row.id,
      "Check portfolio",
    );
  });

  it("maps missing provider failures to a user-actionable chat error", async () => {
    const row = makeSessionRow({ mode: "mission", initialGoal: "Existing" });
    mocks.getSessionById.mockResolvedValue({ ok: true, data: row });
    mocks.submitOperatorInstruction.mockRejectedValue(
      new Error("No inference provider available"),
    );
    registerChatSubmitHandler();

    const fn = handlers.get(CH.chat.submit)!;
    const result = (await fn(trustedSender, {
      requestId: "r3",
      payload: {
        sessionId: row.id,
        message: "Continue",
      },
    })) as { ok: boolean; error?: { code: string; userActionable: boolean } };

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("provider.unavailable");
    expect(result.error?.userActionable).toBe(true);
  });
});

function makeSessionRow(args: {
  readonly mode: "agent" | "mission";
  readonly initialGoal: string | null;
}): SessionListItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    mode: args.mode,
    permission: "restricted",
    title: "Test session",
    initialGoal: args.initialGoal,
    startedAt: new Date("2026-05-19T12:00:00.000Z").toISOString(),
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
  };
}
