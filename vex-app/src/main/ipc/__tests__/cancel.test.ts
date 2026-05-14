/**
 * Tests for the `vex:cancel` handler. Verifies:
 *  - known correlationId → {cancelled: true} + controller fires abort
 *  - unknown correlationId → {cancelled: false} (idempotent, no error)
 *  - double-cancel of same id → second returns {cancelled: false}
 *  - invalid input (non-UUID correlationId) is rejected at the Zod
 *    boundary with `validation.invalid_input`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (
  event: { senderFrame: { url: string; parent: null; top: any } },
  raw: unknown,
) => unknown;

const handlers = new Map<string, Handler>();
const cleanupTasks = new Set<() => void | Promise<void>>();

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

vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
  },
}));

vi.mock("../../lifecycle/cleanup-registry.js", () => ({
  globalCleanup: {
    add: (task: () => void | Promise<void>) => {
      cleanupTasks.add(task);
      return async () => {
        cleanupTasks.delete(task);
      };
    },
  },
}));

function trustedSender(): { senderFrame: { url: string; parent: null; top: any } } {
  const frame: { url: string; parent: null; top: any } = {
    url: "app://vex/index.html",
    parent: null,
    top: null,
  };
  frame.top = frame;
  return { senderFrame: frame };
}

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

async function loadRegisterAndCancel() {
  vi.resetModules();
  const reg = await import("../register-handler.js");
  const can = await import("../cancel.js");
  reg.__resetCancelRegistryForTests();
  return { ...reg, ...can };
}

describe("vex:cancel handler", () => {
  beforeEach(() => {
    handlers.clear();
    cleanupTasks.clear();
  });

  afterEach(() => {
    handlers.clear();
    cleanupTasks.clear();
  });

  it("aborts a known correlationId and returns {cancelled: true}", async () => {
    const { registerHandler, registerCancelHandler } =
      await loadRegisterAndCancel();
    registerCancelHandler();

    // Stand up a long-running fake handler so its controller lands in
    // the registry under VALID_UUID.
    let proceed: (() => void) | null = null;
    let observedAborted = false;
    const { z } = await import("zod");
    registerHandler({
      channel: "vex:test:long",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async (_i, ctx) => {
        await new Promise<void>((resolve) => {
          proceed = resolve;
        });
        observedAborted = ctx.signal.aborted;
        return { ok: true as const, data: undefined };
      },
    });
    const longFn = handlers.get("vex:test:long")!;
    const pending = longFn(trustedSender(), {
      requestId: VALID_UUID,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 0));

    const cancelFn = handlers.get("vex:cancel")!;
    const cancelRes: any = await cancelFn(trustedSender(), {
      requestId: "22222222-3333-4444-8555-666666666666",
      payload: { correlationId: VALID_UUID },
    });
    expect(cancelRes).toEqual({ ok: true, data: { cancelled: true } });

    proceed!();
    await pending;
    expect(observedAborted).toBe(true);
  });

  it("returns {cancelled: false} when correlationId is unknown", async () => {
    const { registerCancelHandler } = await loadRegisterAndCancel();
    registerCancelHandler();
    const cancelFn = handlers.get("vex:cancel")!;
    const result: any = await cancelFn(trustedSender(), {
      requestId: "22222222-3333-4444-8555-666666666666",
      payload: {
        correlationId: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      },
    });
    expect(result).toEqual({ ok: true, data: { cancelled: false } });
  });

  it("a second cancel for the same id returns {cancelled: false}", async () => {
    const { registerHandler, registerCancelHandler } =
      await loadRegisterAndCancel();
    registerCancelHandler();

    const { z } = await import("zod");
    let proceed: (() => void) | null = null;
    registerHandler({
      channel: "vex:test:long2",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => {
        await new Promise<void>((resolve) => {
          proceed = resolve;
        });
        return { ok: true as const, data: undefined };
      },
    });
    const longFn = handlers.get("vex:test:long2")!;
    const pending = longFn(trustedSender(), {
      requestId: VALID_UUID,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 0));

    const cancelFn = handlers.get("vex:cancel")!;
    const first: any = await cancelFn(trustedSender(), {
      requestId: "22222222-3333-4444-8555-666666666666",
      payload: { correlationId: VALID_UUID },
    });
    expect(first.data.cancelled).toBe(true);

    // Let the handler finish so the registry empties.
    proceed!();
    await pending;

    // Second cancel — id already removed.
    const second: any = await cancelFn(trustedSender(), {
      requestId: "33333333-4444-5555-8666-777777777777",
      payload: { correlationId: VALID_UUID },
    });
    expect(second.data.cancelled).toBe(false);
  });

  it("second cancel BEFORE the target completes returns {cancelled: false} (already aborted)", async () => {
    const { registerHandler, registerCancelHandler } =
      await loadRegisterAndCancel();
    registerCancelHandler();

    const { z } = await import("zod");
    let proceed: (() => void) | null = null;
    registerHandler({
      channel: "vex:test:long3",
      domain: "system",
      inputSchema: z.object({}).strict(),
      handle: async () => {
        await new Promise<void>((resolve) => {
          proceed = resolve;
        });
        return { ok: true as const, data: undefined };
      },
    });
    const longFn = handlers.get("vex:test:long3")!;
    const pending = longFn(trustedSender(), {
      requestId: VALID_UUID,
      payload: {},
    });
    await new Promise((r) => setTimeout(r, 0));

    const cancelFn = handlers.get("vex:cancel")!;
    // First cancel — succeeds.
    const first: any = await cancelFn(trustedSender(), {
      requestId: "22222222-3333-4444-8555-666666666666",
      payload: { correlationId: VALID_UUID },
    });
    expect(first.data.cancelled).toBe(true);

    // Second cancel BEFORE the handler finishes — the controller is
    // still in the registry but already aborted. Codex turn 14 fix:
    // must return false, not true again.
    const second: any = await cancelFn(trustedSender(), {
      requestId: "33333333-4444-5555-8666-777777777777",
      payload: { correlationId: VALID_UUID },
    });
    expect(second.data.cancelled).toBe(false);

    // Cleanup: let the handler finish.
    proceed!();
    await pending;
  });

  it("rejects a non-UUID correlationId via Zod boundary", async () => {
    const { registerCancelHandler } = await loadRegisterAndCancel();
    registerCancelHandler();
    const cancelFn = handlers.get("vex:cancel")!;
    const result: any = await cancelFn(trustedSender(), {
      requestId: "22222222-3333-4444-8555-666666666666",
      payload: { correlationId: "not-a-uuid" },
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
  });
});
