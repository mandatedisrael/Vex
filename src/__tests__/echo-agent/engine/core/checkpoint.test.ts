import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────
//
// The checkpoint module composes sessions repo + messages repo + episodes repo
// + embeddings client + provider calls. We mock each at the import boundary so
// we can assert on behavior without a real DB or model.

const mockGetSession = vi.fn();
const mockSetRollingSummary = vi.fn();
const mockArchivePrefix = vi.fn();
const mockForkToolMessageToArchive = vi.fn();

const mockGetLiveMessagesWithId = vi.fn();

const mockInsertEpisodes = vi.fn();

const mockEmbedDocument = vi.fn();

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  setRollingSummary: (...a: unknown[]) => mockSetRollingSummary(...a),
  archivePrefix: (...a: unknown[]) => mockArchivePrefix(...a),
  forkToolMessageToArchive: (...a: unknown[]) => mockForkToolMessageToArchive(...a),
}));

vi.mock("@echo-agent/db/repos/messages.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/db/repos/messages.js")>(
    "@echo-agent/db/repos/messages.js",
  );
  return {
    ...actual,
    getLiveMessagesWithId: (...a: unknown[]) => mockGetLiveMessagesWithId(...a),
  };
});

vi.mock("@echo-agent/db/repos/session-episodes.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/db/repos/session-episodes.js")>(
    "@echo-agent/db/repos/session-episodes.js",
  );
  return {
    ...actual,
    insertEpisodes: (...a: unknown[]) => mockInsertEpisodes(...a),
  };
});

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...a: unknown[]) => mockEmbedDocument(...a),
  embedQuery: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const {
  shouldCheckpoint,
  executeCheckpoint,
  __resetCheckpointCooldownForTests,
} = await import("../../../../echo-agent/engine/core/checkpoint.js");

// ── Helpers ───────────────────────────────────────────────────

function makeProvider(opts: {
  summary?: string;
  episodes?: unknown;
  failSummary?: boolean;
  failExtract?: boolean;
} = {}) {
  const simple = vi.fn().mockImplementation(async (messages: any[]) => {
    const prompt = messages[0]?.content ?? "";
    const isSummary = prompt.includes("rolling summary");
    if (isSummary) {
      if (opts.failSummary) throw new Error("summary boom");
      return { content: opts.summary ?? "rolling summary text", usage: {} };
    }
    if (opts.failExtract) throw new Error("extract boom");
    const body =
      opts.episodes === undefined
        ? "[]"
        : typeof opts.episodes === "string"
        ? opts.episodes
        : JSON.stringify(opts.episodes);
    return { content: body, usage: {} };
  });

  return { chatCompletionSimple: simple };
}

function msg(
  id: number,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  extras: { toolCallId?: string; toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }> } = {},
) {
  return {
    id,
    role,
    content,
    toolCallId: extras.toolCallId,
    toolCalls: extras.toolCalls,
    timestamp: `2026-04-01T00:00:${id.toString().padStart(2, "0")}Z`,
  };
}

function buildPrefixScenario() {
  // Needs to exceed TAIL_WINDOW (10) so there is a non-empty prefix to compact.
  // Includes one tool_call pair in the prefix half so the pair-integrity path
  // is exercised in the happy-path SQL, not only in messages-prefix.test.ts.
  return [
    msg(1, "user", "hi"),
    msg(2, "assistant", "hello"),
    msg(3, "user", "do x"),
    msg(4, "assistant", "", {
      toolCalls: [{ id: "tc-1", command: "foo", args: {} }],
    }),
    msg(5, "tool", "result", { toolCallId: "tc-1" }),
    msg(6, "assistant", "done"),
    msg(7, "user", "and y"),
    msg(8, "assistant", "ok"),
    msg(9, "user", "now z"),
    msg(10, "assistant", "fine"),
    msg(11, "user", "check"),
    msg(12, "assistant", "checked"),
    msg(13, "user", "continue"),
    msg(14, "assistant", "continuing"),
    msg(15, "user", "last"),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCheckpointCooldownForTests();
  mockGetSession.mockResolvedValue({ id: "session-1", summary: null });
  // Return one row per inserted spec, preserving episodeKind so the
  // placeholder-picking logic in executeCheckpoint can find the right episode.
  mockInsertEpisodes.mockImplementation(async (rows: any[]) =>
    rows.map((r, i) => ({ id: i + 100, episodeKind: r.episodeKind })),
  );
  mockEmbedDocument.mockResolvedValue({
    embedding: [0.1, 0.2, 0.3, 0.4],
    providerModel: "test-embed-model",
  });
});

// ── shouldCheckpoint ──────────────────────────────────────────

describe("shouldCheckpoint", () => {
  it("returns false when under threshold", () => {
    expect(shouldCheckpoint(50000, 128000)).toBe(false);
  });

  it("returns true at 90% threshold", () => {
    expect(shouldCheckpoint(115200, 128000)).toBe(true);
  });

  it("returns false for zero context limit", () => {
    expect(shouldCheckpoint(50000, 0)).toBe(false);
  });
});

// ── executeCheckpoint — prefix mode ───────────────────────────

describe("executeCheckpoint: prefix mode", () => {
  it("summarizes, archives the prefix, and inserts episodes", async () => {
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixScenario());
    const provider = makeProvider({
      summary: "merged rolling summary",
      episodes: [
        {
          episode_kind: "fact",
          summary_en: "fact A about X",
          facts: { topic: "X" },
          decisions: {},
          open_loops: {},
          entities: ["X"],
          tool_outcomes: {},
        },
        {
          episode_kind: "decision",
          summary_en: "chose option Y",
          facts: {},
          decisions: { choice: "Y" },
          open_loops: {},
          entities: [],
          tool_outcomes: {},
        },
      ],
    });

    const result = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    expect(result.mode).toBe("prefix");
    expect(result.summary).toBe("merged rolling summary");
    expect(mockSetRollingSummary).toHaveBeenCalledWith("session-1", "merged rolling summary");
    expect(mockArchivePrefix).toHaveBeenCalledTimes(1);
    const [, cutoffId, tailLen] = mockArchivePrefix.mock.calls[0];
    expect(typeof cutoffId).toBe("number");
    expect(tailLen).toBeGreaterThan(0);
    expect(mockInsertEpisodes).toHaveBeenCalledTimes(1);
    const rows = mockInsertEpisodes.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0].memoryScopeKey).toBe("scope-1");
    expect(rows[0].embeddingModel).toBe("test-embed-model");
    expect(rows[0].embeddingDim).toBe(4);
  });

  it("passes previousSummary into the compaction prompt (rolling merge)", async () => {
    mockGetSession.mockResolvedValue({ id: "session-1", summary: "earlier summary" });
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixScenario());
    const provider = makeProvider({ summary: "merged" });

    await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    const firstCall = provider.chatCompletionSimple.mock.calls[0];
    const promptText = firstCall[0][0].content;
    expect(promptText).toContain("earlier summary");
    expect(promptText).toContain("rolling summary");
  });

  it("continues summary + archive when extraction JSON parse fails", async () => {
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixScenario());
    const provider = makeProvider({ summary: "ok", episodes: "this is not json" });

    const result = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    expect(result.mode).toBe("prefix");
    expect(mockSetRollingSummary).toHaveBeenCalled();
    expect(mockArchivePrefix).toHaveBeenCalled();
    expect(mockInsertEpisodes).not.toHaveBeenCalled();
  });

  it("skips episode insert when embedding fails for every row", async () => {
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixScenario());
    mockEmbedDocument.mockRejectedValue(new Error("embed boom"));
    const provider = makeProvider({
      summary: "ok",
      episodes: [
        {
          episode_kind: "fact",
          summary_en: "a",
          facts: {},
          decisions: {},
          open_loops: {},
          entities: [],
          tool_outcomes: {},
        },
      ],
    });

    const result = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    expect(result.mode).toBe("prefix");
    expect(mockSetRollingSummary).toHaveBeenCalled();
    expect(mockInsertEpisodes).not.toHaveBeenCalled();
    expect(mockArchivePrefix).toHaveBeenCalled();
  });
});

// ── executeCheckpoint — giant tool mode ───────────────────────

describe("executeCheckpoint: giant_tool mode", () => {
  it("fork-copies the bloated tool row and synthesizes a tool_result_summary episode", async () => {
    const bloated = "X".repeat(9_000);
    mockGetLiveMessagesWithId.mockResolvedValue([
      msg(50, "user", "go"),
      msg(51, "assistant", "", {
        toolCalls: [{ id: "tc-big", command: "fetch", args: {} }],
      }),
      msg(52, "tool", bloated, { toolCallId: "tc-big" }),
    ]);
    const provider = makeProvider({ summary: "ok", episodes: [] });

    const result = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    expect(result.mode).toBe("giant_tool");
    expect(mockArchivePrefix).not.toHaveBeenCalled();
    expect(mockForkToolMessageToArchive).toHaveBeenCalledTimes(1);
    const [messageId, placeholder] = mockForkToolMessageToArchive.mock.calls[0];
    expect(messageId).toBe(52);
    expect(placeholder).toContain("tool_result_summary");
    expect(placeholder).toContain("message_id=52");

    expect(mockInsertEpisodes).toHaveBeenCalled();
    const rows = mockInsertEpisodes.mock.calls[0][0];
    const hasToolSummary = rows.some((r: any) => r.episodeKind === "tool_result_summary");
    expect(hasToolSummary).toBe(true);
  });

  it("places the tool_result_summary episode id in the placeholder — not the first inserted episode", async () => {
    const bloated = "X".repeat(9_000);
    mockGetLiveMessagesWithId.mockResolvedValue([
      msg(50, "user", "go"),
      msg(51, "assistant", "", {
        toolCalls: [{ id: "tc-big", command: "fetch", args: {} }],
      }),
      msg(52, "tool", bloated, { toolCallId: "tc-big" }),
    ]);

    // Extractor returns a mixed batch where the tool_result_summary is NOT first.
    // Episode ids will therefore be 100=decision, 101=fact, 102=tool_result_summary.
    const provider = makeProvider({
      summary: "ok",
      episodes: [
        {
          episode_kind: "decision",
          summary_en: "decide Y",
          facts: {},
          decisions: {},
          open_loops: {},
          entities: [],
          tool_outcomes: {},
        },
        {
          episode_kind: "fact",
          summary_en: "fact Z",
          facts: {},
          decisions: {},
          open_loops: {},
          entities: [],
          tool_outcomes: {},
        },
        {
          episode_kind: "tool_result_summary",
          summary_en: "tool output summary",
          facts: {},
          decisions: {},
          open_loops: {},
          entities: [],
          tool_outcomes: {},
        },
      ],
    });

    await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);

    const [, placeholder] = mockForkToolMessageToArchive.mock.calls[0];
    expect(placeholder).toContain("tool_result_summary#102");
    expect(placeholder).not.toContain("#100");
    expect(placeholder).not.toContain("#101");
  });
});

// ── executeCheckpoint — noop + cooldown ───────────────────────

describe("executeCheckpoint: noop + cooldown", () => {
  it("returns noop on empty session and engages cooldown", async () => {
    mockGetLiveMessagesWithId.mockResolvedValue([]);
    const provider = makeProvider();

    const first = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);
    expect(first.mode).toBe("noop");
    expect(provider.chatCompletionSimple).not.toHaveBeenCalled();

    // Second call within cooldown window — still noop, and no provider call.
    const second = await executeCheckpoint("session-1", "scope-1", provider as any, {} as any);
    expect(second.mode).toBe("noop");
    expect(provider.chatCompletionSimple).not.toHaveBeenCalled();
  });
});
