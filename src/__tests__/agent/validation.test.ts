import { describe, it, expect } from "vitest";
import {
  RequestValidationError,
  parseChatRequest,
  parseApproveRequest,
  parseToggleTaskRequest,
  parseTelegramConfigRequest,
  parseLoopStartRequest,
} from "../../agent/validation.js";

// ── parseChatRequest ────────────────────────────────────────────────

describe("parseChatRequest", () => {
  it("returns message and default loopMode 'off'", () => {
    const result = parseChatRequest({ message: "Hello" });
    expect(result.message).toBe("Hello");
    expect(result.loopMode).toBe("off");
    expect(result.sessionId).toBeUndefined();
  });

  it("trims the message", () => {
    const result = parseChatRequest({ message: "  Hello  " });
    expect(result.message).toBe("Hello");
  });

  it("accepts valid loopMode values", () => {
    expect(parseChatRequest({ message: "x", loopMode: "full" }).loopMode).toBe("full");
    expect(parseChatRequest({ message: "x", loopMode: "restricted" }).loopMode).toBe("restricted");
    expect(parseChatRequest({ message: "x", loopMode: "off" }).loopMode).toBe("off");
  });

  it("passes sessionId when string", () => {
    const result = parseChatRequest({ message: "x", sessionId: "sess-123" });
    expect(result.sessionId).toBe("sess-123");
  });

  it("throws on missing message", () => {
    expect(() => parseChatRequest({})).toThrow(RequestValidationError);
    expect(() => parseChatRequest(null)).toThrow(RequestValidationError);
  });

  it("throws on empty message", () => {
    expect(() => parseChatRequest({ message: "" })).toThrow(RequestValidationError);
    expect(() => parseChatRequest({ message: "   " })).toThrow(RequestValidationError);
  });

  it("throws on non-string message", () => {
    expect(() => parseChatRequest({ message: 42 })).toThrow(RequestValidationError);
  });

  it("throws on invalid loopMode", () => {
    expect(() => parseChatRequest({ message: "x", loopMode: "invalid" })).toThrow(RequestValidationError);
  });

  it("throws on non-string sessionId", () => {
    expect(() => parseChatRequest({ message: "x", sessionId: 123 })).toThrow(RequestValidationError);
  });

  it("error has correct field property", () => {
    try {
      parseChatRequest({});
    } catch (e) {
      expect(e).toBeInstanceOf(RequestValidationError);
      expect((e as RequestValidationError).field).toBe("message");
    }
  });
});

// ── parseApproveRequest ─────────────────────────────────────────────

describe("parseApproveRequest", () => {
  it("returns id and default action 'approve'", () => {
    const result = parseApproveRequest({}, { id: "abc" });
    expect(result.id).toBe("abc");
    expect(result.action).toBe("approve");
  });

  it("accepts action 'reject'", () => {
    const result = parseApproveRequest({ action: "reject" }, { id: "abc" });
    expect(result.action).toBe("reject");
  });

  it("throws on missing id", () => {
    expect(() => parseApproveRequest({}, {})).toThrow(RequestValidationError);
  });

  it("throws on empty id", () => {
    expect(() => parseApproveRequest({}, { id: "  " })).toThrow(RequestValidationError);
  });

  it("throws on invalid action", () => {
    expect(() => parseApproveRequest({ action: "cancel" }, { id: "abc" })).toThrow(RequestValidationError);
  });
});

// ── parseToggleTaskRequest ──────────────────────────────────────────

describe("parseToggleTaskRequest", () => {
  it("returns id and default enabled true", () => {
    const result = parseToggleTaskRequest({}, { id: "task-1" });
    expect(result.id).toBe("task-1");
    expect(result.enabled).toBe(true);
  });

  it("accepts explicit enabled false", () => {
    const result = parseToggleTaskRequest({ enabled: false }, { id: "task-1" });
    expect(result.enabled).toBe(false);
  });

  it("throws on missing id", () => {
    expect(() => parseToggleTaskRequest({}, {})).toThrow(RequestValidationError);
  });

  it("throws on non-boolean enabled", () => {
    expect(() => parseToggleTaskRequest({ enabled: "yes" }, { id: "task-1" })).toThrow(RequestValidationError);
  });
});

// ── parseTelegramConfigRequest ──────────────────────────────────────

describe("parseTelegramConfigRequest", () => {
  const validBody = {
    botToken: "123456:ABC-DEF_ghijklmnop",
    chatIds: [100, 200],
  };

  it("returns valid config with default loopMode 'restricted'", () => {
    const result = parseTelegramConfigRequest(validBody);
    expect(result.botToken).toBe(validBody.botToken);
    expect(result.chatIds).toEqual([100, 200]);
    expect(result.loopMode).toBe("restricted");
  });

  it("accepts explicit loopMode", () => {
    const result = parseTelegramConfigRequest({ ...validBody, loopMode: "full" });
    expect(result.loopMode).toBe("full");
  });

  it("throws on missing botToken", () => {
    expect(() => parseTelegramConfigRequest({ chatIds: [1] })).toThrow(RequestValidationError);
  });

  it("throws on invalid botToken format", () => {
    expect(() => parseTelegramConfigRequest({ botToken: "invalid", chatIds: [1] })).toThrow(RequestValidationError);
  });

  it("throws on empty chatIds", () => {
    expect(() => parseTelegramConfigRequest({ botToken: validBody.botToken, chatIds: [] })).toThrow(RequestValidationError);
  });

  it("throws on non-integer chatId", () => {
    expect(() => parseTelegramConfigRequest({ botToken: validBody.botToken, chatIds: [1.5] })).toThrow(RequestValidationError);
  });

  it("throws on invalid loopMode", () => {
    expect(() => parseTelegramConfigRequest({ ...validBody, loopMode: "auto" })).toThrow(RequestValidationError);
  });
});

// ── parseLoopStartRequest ───────────────────────────────────────────

describe("parseLoopStartRequest", () => {
  it("returns mode and default intervalMs 300000", () => {
    const result = parseLoopStartRequest({ mode: "full" });
    expect(result.mode).toBe("full");
    expect(result.intervalMs).toBe(300_000);
  });

  it("accepts mode 'restricted'", () => {
    const result = parseLoopStartRequest({ mode: "restricted" });
    expect(result.mode).toBe("restricted");
  });

  it("accepts custom intervalMs within range", () => {
    const result = parseLoopStartRequest({ mode: "full", intervalMs: 60_000 });
    expect(result.intervalMs).toBe(60_000);
  });

  it("throws on missing mode", () => {
    expect(() => parseLoopStartRequest({})).toThrow(RequestValidationError);
  });

  it("throws on mode 'off' (not an active loop mode)", () => {
    expect(() => parseLoopStartRequest({ mode: "off" })).toThrow(RequestValidationError);
  });

  it("throws on intervalMs below minimum (30000)", () => {
    expect(() => parseLoopStartRequest({ mode: "full", intervalMs: 1000 })).toThrow(RequestValidationError);
  });

  it("throws on intervalMs above maximum (86400000)", () => {
    expect(() => parseLoopStartRequest({ mode: "full", intervalMs: 100_000_000 })).toThrow(RequestValidationError);
  });

  it("throws on non-number intervalMs", () => {
    expect(() => parseLoopStartRequest({ mode: "full", intervalMs: "fast" })).toThrow(RequestValidationError);
  });

  it("accepts exact boundary values", () => {
    expect(parseLoopStartRequest({ mode: "full", intervalMs: 30_000 }).intervalMs).toBe(30_000);
    expect(parseLoopStartRequest({ mode: "full", intervalMs: 86_400_000 }).intervalMs).toBe(86_400_000);
  });
});
