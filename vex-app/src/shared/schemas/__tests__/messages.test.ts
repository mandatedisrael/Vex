import { describe, expect, it } from "vitest";
import {
  messageCursorSchema,
  messageKindSchema,
  messagePageSchema,
  messageRoleSchema,
  messagesGetAroundInputSchema,
  messagesGetTailInputSchema,
  messagesListInputSchema,
  sessionMessageDtoSchema,
  transcriptAppendEventSchema,
  TRANSCRIPT_APPEND_EVENT_TYPE,
} from "../messages.js";

const ISO = "2026-05-21T10:00:00.000Z";
const SESSION = "00000000-0000-4000-8000-000000000001";

describe("messages schemas", () => {
  it("role + kind enums accept canonical values", () => {
    for (const r of ["system", "user", "assistant", "tool"]) {
      expect(messageRoleSchema.safeParse(r).success).toBe(true);
    }
    for (const k of ["text", "tool_call", "tool_result", "runtime_notice", "error"]) {
      expect(messageKindSchema.safeParse(k).success).toBe(true);
    }
  });

  it("rejects exotic role / kind", () => {
    expect(messageRoleSchema.safeParse("hacker").success).toBe(false);
    expect(messageKindSchema.safeParse("compaction").success).toBe(false);
  });

  it("sessionMessageDtoSchema parses a typical text row", () => {
    const parsed = sessionMessageDtoSchema.safeParse({
      id: 12,
      sessionId: SESSION,
      role: "assistant",
      kind: "text",
      content: "hello",
      createdAt: ISO,
      toolCallId: null,
      toolName: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects DTO with extra fields (.strict)", () => {
    const parsed = sessionMessageDtoSchema.safeParse({
      id: 1,
      sessionId: SESSION,
      role: "user",
      kind: "text",
      content: "x",
      createdAt: ISO,
      toolCallId: null,
      toolName: null,
      metadata: { leaky: "value" },
    });
    expect(parsed.success).toBe(false);
  });

  it("messageCursorSchema requires datetime + positive int id", () => {
    expect(
      messageCursorSchema.safeParse({ createdAt: ISO, id: 7 }).success,
    ).toBe(true);
    expect(
      messageCursorSchema.safeParse({ createdAt: ISO, id: 0 }).success,
    ).toBe(false);
    expect(
      messageCursorSchema.safeParse({ createdAt: "yesterday", id: 1 }).success,
    ).toBe(false);
  });

  it("messagesGetTailInputSchema clamps limit to [1, 100] with default 50", () => {
    const parsed = messagesGetTailInputSchema.safeParse({ sessionId: SESSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);

    expect(
      messagesGetTailInputSchema.safeParse({ sessionId: SESSION, limit: 0 })
        .success,
    ).toBe(false);
    expect(
      messagesGetTailInputSchema.safeParse({ sessionId: SESSION, limit: 101 })
        .success,
    ).toBe(false);
  });

  it("messagesListInputSchema defaults cursor to null", () => {
    const parsed = messagesListInputSchema.safeParse({ sessionId: SESSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cursor).toBeNull();
      expect(parsed.data.limit).toBe(50);
    }
  });

  it("messagesGetAroundInputSchema requires positive messageId + clamps windows", () => {
    expect(
      messagesGetAroundInputSchema.safeParse({
        sessionId: SESSION,
        messageId: 0,
      }).success,
    ).toBe(false);
    expect(
      messagesGetAroundInputSchema.safeParse({
        sessionId: SESSION,
        messageId: 5,
        before: 60,
      }).success,
    ).toBe(false);
  });

  it("messagePageSchema validates wrapper shape", () => {
    const parsed = messagePageSchema.safeParse({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("transcriptAppendEventSchema", () => {
  const VALID = {
    type: TRANSCRIPT_APPEND_EVENT_TYPE,
    sessionId: SESSION,
    messageId: 7,
    role: "assistant" as const,
    createdAt: ISO,
    messageType: "chat",
    correlationId: null,
  };

  it("accepts a canonical engine.transcript.append payload", () => {
    expect(transcriptAppendEventSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects payloads with the wrong literal type", () => {
    expect(
      transcriptAppendEventSchema.safeParse({
        ...VALID,
        type: "engine.transcript.update",
      }).success,
    ).toBe(false);
  });

  it("rejects non-positive messageId", () => {
    expect(
      transcriptAppendEventSchema.safeParse({ ...VALID, messageId: 0 }).success,
    ).toBe(false);
    expect(
      transcriptAppendEventSchema.safeParse({ ...VALID, messageId: -1 }).success,
    ).toBe(false);
  });

  it("rejects non-UUID sessionId", () => {
    expect(
      transcriptAppendEventSchema.safeParse({
        ...VALID,
        sessionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects role outside the canonical enum", () => {
    expect(
      transcriptAppendEventSchema.safeParse({ ...VALID, role: "hacker" }).success,
    ).toBe(false);
  });

  it("rejects extra fields (.strict)", () => {
    expect(
      transcriptAppendEventSchema.safeParse({
        ...VALID,
        extra: "smuggle",
      }).success,
    ).toBe(false);
  });

  it("accepts null messageType and null correlationId", () => {
    expect(
      transcriptAppendEventSchema.safeParse({
        ...VALID,
        messageType: null,
        correlationId: null,
      }).success,
    ).toBe(true);
  });
});
