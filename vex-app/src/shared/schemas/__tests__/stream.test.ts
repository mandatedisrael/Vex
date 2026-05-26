import { describe, expect, it } from "vitest";

import {
  STREAM_DELTA_EVENT_TYPE,
  streamDeltaEventSchema,
} from "../stream.js";

const SESSION = "00000000-0000-4000-8000-000000000001";

function evt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: STREAM_DELTA_EVENT_TYPE,
    sessionId: SESSION,
    streamId: "stream-1",
    sequence: 0,
    deltaType: "text",
    delta: { kind: "text", text: "hi" },
    createdAt: "2026-05-26T10:00:00.000Z",
    correlationId: null,
    ...overrides,
  };
}

describe("streamDeltaEventSchema", () => {
  it("keeps the event-type literal in sync with the engine", () => {
    expect(STREAM_DELTA_EVENT_TYPE).toBe("engine.stream.delta");
  });

  it("accepts each delta kind", () => {
    const cases: Array<{ deltaType: string; delta: Record<string, unknown> }> = [
      { deltaType: "text", delta: { kind: "text", text: "tok" } },
      {
        deltaType: "tool_call",
        delta: { kind: "tool_call", toolCallIndex: 0, toolCallId: "c1", toolCallName: "transfer" },
      },
      { deltaType: "reasoning", delta: { kind: "reasoning", text: "think" } },
      {
        deltaType: "usage",
        delta: {
          kind: "usage",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      },
      { deltaType: "done", delta: { kind: "done" } },
      { deltaType: "error", delta: { kind: "error", message: "Stream error", code: 429 } },
    ];
    for (const c of cases) {
      const result = streamDeltaEventSchema.safeParse(evt(c));
      expect(result.success, `${c.deltaType} should parse`).toBe(true);
    }
  });

  it("allows nullable tool_call id/name and error code", () => {
    const toolCall = streamDeltaEventSchema.safeParse(
      evt({
        deltaType: "tool_call",
        delta: { kind: "tool_call", toolCallIndex: 0, toolCallId: null, toolCallName: null },
      }),
    );
    expect(toolCall.success).toBe(true);

    const err = streamDeltaEventSchema.safeParse(
      evt({ deltaType: "error", delta: { kind: "error", message: "Stream error", code: null } }),
    );
    expect(err.success).toBe(true);
  });

  it("rejects a tool_call delta that smuggles a raw args fragment (strict)", () => {
    const result = streamDeltaEventSchema.safeParse(
      evt({
        deltaType: "tool_call",
        delta: {
          kind: "tool_call",
          toolCallIndex: 0,
          toolCallId: "c1",
          toolCallName: "transfer",
          argsDelta: '{"to":"0xSECRET"}',
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a deltaType that disagrees with delta.kind (refinement)", () => {
    const result = streamDeltaEventSchema.safeParse(
      evt({ deltaType: "usage", delta: { kind: "text", text: "hi" } }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an extra top-level field (strict)", () => {
    expect(streamDeltaEventSchema.safeParse(evt({ extra: "smuggle" })).success).toBe(false);
  });

  it("rejects an extra nested usage field (strict)", () => {
    const result = streamDeltaEventSchema.safeParse(
      evt({
        deltaType: "usage",
        delta: {
          kind: "usage",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, bogus: 9 },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid sessionId, a negative sequence, and a missing field", () => {
    expect(streamDeltaEventSchema.safeParse(evt({ sessionId: "not-a-uuid" })).success).toBe(false);
    expect(streamDeltaEventSchema.safeParse(evt({ sequence: -1 })).success).toBe(false);
    const { sequence: _omit, ...withoutSequence } = evt();
    void _omit;
    expect(streamDeltaEventSchema.safeParse(withoutSequence).success).toBe(false);
  });
});
