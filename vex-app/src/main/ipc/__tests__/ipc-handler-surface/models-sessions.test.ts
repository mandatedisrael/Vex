/**
 * IPC handler surface smoke tests — sender validation, payload validation,
 * read-only success paths, and mutation handler registration. One file
 * bundles the broad surface to keep CI run-time tight.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const mocks = vi.hoisted(() => ({
  // messages-db
  getMessageTail: vi.fn(),
  getMessageAround: vi.fn(),
  listMessages: vi.fn(),
  // usage-db
  getSessionTotals: vi.fn(),
  getLastTurn: vi.fn(),
  getContextWindow: vi.fn(),
  // compaction-db
  getCompactionStatus: vi.fn(),
  listCompactionHistory: vi.fn(),
  // memory-db
  listSessionMemories: vi.fn(),
  getMemoryStats: vi.fn(),
  // mission-runs-db
  getActiveRunForSession: vi.fn(),
  // approvals-db
  listPendingForSession: vi.fn(),
  getApprovalById: vi.fn(),
  getHistoryForSession: vi.fn(),
  // missions-db
  getDraftForSession: vi.fn(),
  // engine inference registry (S6 — sessions.getModel capability probe)
  resolveProvider: vi.fn(),
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

vi.mock("../../../database/messages-db.js", () => ({
  getMessageTail: mocks.getMessageTail,
  getMessageAround: mocks.getMessageAround,
  listMessages: mocks.listMessages,
}));

vi.mock("../../../database/usage-db.js", () => ({
  getSessionTotals: mocks.getSessionTotals,
  getLastTurn: mocks.getLastTurn,
  getContextWindow: mocks.getContextWindow,
}));

vi.mock("../../../database/compaction-db.js", () => ({
  getCompactionStatus: mocks.getCompactionStatus,
  listCompactionHistory: mocks.listCompactionHistory,
  getRetryableCompactJob: vi.fn(),
  probeCompactJobsReady: vi.fn(),
}));

vi.mock("../../../database/memory-db.js", () => ({
  listSessionMemories: mocks.listSessionMemories,
  getMemoryStats: mocks.getMemoryStats,
}));

vi.mock("../../../database/mission-runs-db.js", () => ({
  getActiveRunForSession: mocks.getActiveRunForSession,
}));

vi.mock("../../../database/approvals-db.js", () => ({
  listPendingForSession: mocks.listPendingForSession,
  getApprovalById: mocks.getApprovalById,
  getHistoryForSession: mocks.getHistoryForSession,
}));

vi.mock("../../../database/missions-db.js", () => ({
  getDraftForSession: mocks.getDraftForSession,
}));

vi.mock("../../../logger/index.js", () => ({ log: mocks.log }));

// S6: sessions.getModel probes the ENGINE inference config for reasoning
// support — mock the registry so the surface test never touches env/network.
vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: mocks.resolveProvider,
}));

const { registerMessagesHandlers } = await import("../../messages.js");
const { registerUsageHandlers } = await import("../../usage.js");
const { registerCompactionHandlers } = await import("../../compaction.js");
const { registerMemoryHandlers } = await import("../../memory.js");
const { registerRuntimeHandlers } = await import("../../runtime.js");
const { registerMissionHandlers } = await import("../../mission.js");
const { registerApprovalsHandlers } = await import("../../approvals.js");
const { registerWalletsSessionHandlers } = await import("../../wallets-session.js");
const { registerModelsHandlers } = await import("../../models.js");
const { registerSessionsGetModelHandler } = await import("../../sessions/get-model.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });
const SESSION = "00000000-0000-4000-8000-00000000fff1";

function untrustedSender(): TestIpcEvent {
  return {
    senderFrame: {
      url: "https://evil.example",
      parent: null,
      top: null as never,
    },
    sender: createTestWebContents(),
  };
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerMessagesHandlers();
  registerUsageHandlers();
  registerCompactionHandlers();
  registerMemoryHandlers();
  registerRuntimeHandlers();
  registerMissionHandlers();
  registerApprovalsHandlers();
  registerWalletsSessionHandlers();
  registerModelsHandlers();
  registerSessionsGetModelHandler();
});

afterEach(() => {
  handlers.clear();
  delete process.env.AGENT_PROVIDER;
  delete process.env.AGENT_MODEL;
  delete process.env.AGENT_CONTEXT_LIMIT;
});

type ResultShape = { ok: boolean; data?: unknown; error?: { code: string; domain: string } };

async function call(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(trustedSender, { requestId: "test-corr", payload })) as ResultShape;
}

async function callUntrusted(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(untrustedSender(), {
    requestId: "test-corr",
    payload,
  })) as ResultShape;
}

describe("models handler", () => {
  it("returns unconfigured when AGENT_PROVIDER / AGENT_MODEL are absent", async () => {
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    const result = await call(CH.models.listAvailable, {});
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("unconfigured");
    expect((result.data as { models: unknown[] }).models).toEqual([]);
  });

  it("returns global_default with single option when env present", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    const result = await call(CH.models.listAvailable, {});
    expect(result.ok).toBe(true);
    const data = result.data as { source: string; models: { modelId: string }[] };
    expect(data.source).toBe("global_default");
    expect(data.models).toHaveLength(1);
    expect(data.models[0]!.modelId).toBe("anthropic/claude-opus-4.7");
  });
});

function providerWithReasoningPrice(reasoningPricePerM: number | null): {
  loadConfig: () => Promise<{ reasoningPricePerM: number | null }>;
} {
  return {
    loadConfig: async () => ({ reasoningPricePerM }),
  };
}

describe("sessions.getModel handler", () => {
  it("getModel returns global_default when env present", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    mocks.resolveProvider.mockResolvedValue(null);
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("global_default");
  });

  it("getModel returns unconfigured when env absent", async () => {
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("unconfigured");
    expect(
      (result.data as { supportsReasoning: boolean | null }).supportsReasoning,
    ).toBeNull();
  });

  it("getModel reports supportsReasoning=true when the catalog prices reasoning", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    mocks.resolveProvider.mockResolvedValue(providerWithReasoningPrice(15));
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(
      (result.data as { supportsReasoning: boolean | null }).supportsReasoning,
    ).toBe(true);
  });

  it("getModel reports supportsReasoning=false when the catalog has no reasoning price", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "deepseek/deepseek-chat";
    mocks.resolveProvider.mockResolvedValue(providerWithReasoningPrice(null));
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(
      (result.data as { supportsReasoning: boolean | null }).supportsReasoning,
    ).toBe(false);
  });

  it("getModel degrades to supportsReasoning=null when the provider is unavailable", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    process.env.AGENT_MODEL = "anthropic/claude-opus-4.7";
    mocks.resolveProvider.mockRejectedValue(new Error("vault locked"));
    const result = await call(CH.sessions.getModel, { sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect((result.data as { source: string }).source).toBe("global_default");
    expect(
      (result.data as { supportsReasoning: boolean | null }).supportsReasoning,
    ).toBeNull();
  });
});
