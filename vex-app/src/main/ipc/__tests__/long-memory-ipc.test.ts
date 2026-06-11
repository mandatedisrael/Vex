/**
 * Focused contract test for `longMemory.list` (memory-system S9 rewire).
 *
 * Mocks `long-memory-db.listLongMemory` so we can assert the Result mapping
 * without a live DB:
 *   ok        → sanitized array passed through
 *   db error  → error Result passed through unchanged
 *   bad input → validation.invalid_input (before the DB is touched)
 *
 * Also pins the READ-ONLY contract: the long-memory channel namespace has
 * exactly one channel (`list`) — the lifecycle is owned by the agent's
 * memory manager, so no mutation channel may ever appear here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "./test-sender.js";

type Handler = (event: TestIpcEvent, raw: unknown) => Promise<unknown>;

const handlers = vi.hoisted(() => new Map<string, Handler>());
const mocks = vi.hoisted(() => ({
  listLongMemory: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

vi.mock("../../database/long-memory-db.js", () => ({
  listLongMemory: mocks.listLongMemory,
}));
vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { registerLongMemoryHandlers } = await import("../long-memory.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

type ResultShape = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; domain: string };
};

async function call(channel: string, payload: unknown): Promise<ResultShape> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`Handler not registered: ${channel}`);
  return (await fn(trustedSender, {
    requestId: "test-corr",
    payload,
  })) as ResultShape;
}

beforeEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  registerLongMemoryHandlers();
});

afterEach(() => {
  handlers.clear();
});

const ISO = "2026-05-21T10:00:00.000Z";

describe("longMemory.list handler", () => {
  it("passes the parsed input to the DB helper and returns its rows", async () => {
    mocks.listLongMemory.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          id: 1,
          kind: "risk_rule",
          title: "Avoid X",
          summary: "s",
          tags: [],
          confidence: null,
          status: "active",
          source: "observed",
          maturityState: "established",
          pinned: false,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ],
    });
    const r = await call(CH.longMemory.list, { status: "active", limit: 25 });
    expect(r.ok).toBe(true);
    expect(mocks.listLongMemory).toHaveBeenCalledWith({
      status: "active",
      limit: 25,
    });
  });

  it("passes a DB error Result through unchanged", async () => {
    mocks.listLongMemory.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "memory",
        message: "Unable to load memory.",
        retryable: true,
        userActionable: false,
        redacted: true,
      },
    });
    const r = await call(CH.longMemory.list, { limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("internal.unexpected");
    expect(r.error?.domain).toBe("memory");
  });

  it("rejects invalid input before touching the DB", async () => {
    const r = await call(CH.longMemory.list, { limit: -1 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("validation.invalid_input");
    expect(mocks.listLongMemory).not.toHaveBeenCalled();
  });

  it("rejects an unknown status value", async () => {
    const r = await call(CH.longMemory.list, { status: "draft", limit: 10 });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("validation.invalid_input");
  });

  it("long-memory is read-only: the channel namespace has exactly `list`", () => {
    expect(Object.keys(CH.longMemory)).toEqual(["list"]);
    // registerLongMemoryHandlers registered exactly one channel.
    expect([...handlers.keys()]).toEqual([CH.longMemory.list]);
  });
});
