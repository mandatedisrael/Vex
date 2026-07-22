/**
 * Unit tests for `selectArchivePrefix` — pure helper, no DB — and a thin
 * structural test for `getAllMessages` to guard the giant-tool dedup path.
 *
 * The prefix helper decides where to cut the live-message array for partial
 * archive. The only invariant the caller cares about is that an
 * `assistant.tool_calls` ↔ `role:'tool'` pair never gets split across the
 * cutoff.
 *
 * `getAllMessages` additionally has to handle the case where the giant-tool
 * fallback forked a live row into archive under the same id — history view
 * must prefer the archived full payload over the live placeholder and must
 * never emit both for the same id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { selectArchivePrefix, getAllMessages } = await import(
  "../../../../vex-agent/db/repos/messages.js"
);

type M = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  timestamp: string;
};

function msg(
  id: number,
  role: M["role"],
  content: string,
  extras: { toolCallId?: string; toolCalls?: M["toolCalls"] } = {},
): M {
  return {
    id,
    role,
    content,
    toolCallId: extras.toolCallId,
    toolCalls: extras.toolCalls,
    timestamp: `2026-04-01T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

describe("selectArchivePrefix", () => {
  it("returns empty plan for empty input", () => {
    const plan = selectArchivePrefix([], 5);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail).toEqual([]);
    expect(plan.cutoffMessageId).toBeNull();
  });

  it("splits cleanly when the boundary lands on a user or assistant turn", () => {
    const messages = [
      msg(1, "user", "a"),
      msg(2, "assistant", "b"),
      msg(3, "user", "c"),
      msg(4, "assistant", "d"),
      msg(5, "user", "e"),
      msg(6, "assistant", "f"),
    ];
    const plan = selectArchivePrefix(messages, 3);
    expect(plan.prefix.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(plan.tail.map((m) => m.id)).toEqual([4, 5, 6]);
    expect(plan.cutoffMessageId).toBe(3);
  });

  it("walks back across tool rows so assistant/tool pairs stay together", () => {
    const messages = [
      msg(1, "user", "start"),
      msg(2, "assistant", "", {
        toolCalls: [
          { id: "a", command: "foo", args: {} },
          { id: "b", command: "foo", args: {} },
        ],
      }),
      msg(3, "tool", "result-a", { toolCallId: "a" }),
      msg(4, "tool", "result-b", { toolCallId: "b" }),
      msg(5, "assistant", "done"),
    ];
    // tailWindow=3 would start at idx 2 (tool). Must walk back to idx 1 (assistant).
    const plan = selectArchivePrefix(messages, 3);
    expect(plan.prefix.map((m) => m.id)).toEqual([1]);
    expect(plan.tail.map((m) => m.id)).toEqual([2, 3, 4, 5]);
    expect(plan.cutoffMessageId).toBe(1);
  });

  it("treats engine system messages as normal tail entries", () => {
    const messages = [
      msg(1, "user", "start"),
      msg(2, "assistant", "a"),
      msg(3, "system", "[Engine: continue]"),
      msg(4, "assistant", "b"),
      msg(5, "user", "next"),
    ];
    const plan = selectArchivePrefix(messages, 2);
    expect(plan.prefix.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(plan.tail.map((m) => m.id)).toEqual([4, 5]);
    expect(plan.cutoffMessageId).toBe(3);
  });

  it("returns empty prefix when every live message is swallowed by the tail window", () => {
    const messages = [msg(1, "user", "hi"), msg(2, "assistant", "hello")];
    const plan = selectArchivePrefix(messages, 10);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail.map((m) => m.id)).toEqual([1, 2]);
    expect(plan.cutoffMessageId).toBeNull();
  });

  it("returns empty prefix when the entire tail backs up onto the first message", () => {
    const messages = [
      msg(1, "assistant", "", {
        toolCalls: [{ id: "only", command: "foo", args: {} }],
      }),
      msg(2, "tool", "r", { toolCallId: "only" }),
    ];
    const plan = selectArchivePrefix(messages, 1);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail.map((m) => m.id)).toEqual([1, 2]);
    expect(plan.cutoffMessageId).toBeNull();
  });
});

describe("getAllMessages dedup (giant-tool fork guard)", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it("issues a SQL statement that prefers archive over live for the same id", async () => {
    await getAllMessages("session-1");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["session-1"]);
    // Archive side first, live side guarded by NOT EXISTS against archive.
    // This is what prevents a forked placeholder row from duplicating the
    // canonical archived payload in history views.
    expect(sql).toMatch(/FROM messages_archive[\s\S]+UNION ALL[\s\S]+FROM messages\b/);
    expect(sql).toMatch(/NOT EXISTS[\s\S]+messages_archive/);
  });

  it("returns archive row payload when live and archive share the same id (fork scenario)", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 42,
        role: "tool",
        content: "full archived payload",
        tool_call_id: "tc-big",
        tool_calls: null,
        created_at: "2026-04-01T00:00:00Z",
        source: "tool",
        message_type: "tool_result",
        visibility: "internal",
        origin_session_id: null,
      },
    ]);

    const result = await getAllMessages("session-1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(42);
    expect(result[0].content).toBe("full archived payload");
  });
});
