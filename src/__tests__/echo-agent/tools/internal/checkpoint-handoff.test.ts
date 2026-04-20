/**
 * PR-9 — `checkpoint_handoff_prepare` handler coverage.
 *
 * Tested:
 *   - band defense-in-depth (rejects `normal`),
 *   - Zod bounds (preserve_md, preferred_recall_query, entities, open_loops),
 *   - JSON-string coercion for array params (tool schema declares `string`),
 *   - targets `session.checkpoint_generation + 1`,
 *   - session-missing error path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWriteHandoff = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@echo-agent/db/repos/checkpoint-handoffs.js", () => ({
  writeHandoff: (...a: unknown[]) => mockWriteHandoff(...a),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));

const { handleCheckpointHandoffPrepare } = await import(
  "../../../../echo-agent/tools/internal/checkpoint-handoff.js"
);

function makeCtx(overrides: Partial<{ sessionId: string; contextUsageBand: "normal" | "warning" | "critical" }> = {}) {
  return {
    sessionId: "sess-1",
    loadedDocuments: new Map<string, string>(),
    loopMode: "restricted" as const,
    approved: false,
    role: "parent" as const,
    missionRunId: null,
    sessionKind: "mission" as const,
    contextUsageBand: "warning" as const,
    ...overrides,
  };
}

const VALID_PARAMS = {
  preserve_md: "Plan agreed with user; step 3 executed; waiting on feed.",
  preferred_recall_query: "Polymarket pendulum bet resume plan",
  important_entities: '["POLY-0x1234", "mission-42"]',
  open_loops: '["Re-check price feed", "Close position if drift > 5%"]',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ id: "sess-1", checkpointGeneration: 4 });
  mockWriteHandoff.mockResolvedValue({
    id: "handoff-1",
    sessionId: "sess-1",
    targetCheckpointGeneration: 5,
    status: "active",
  });
});

describe("checkpoint_handoff_prepare handler", () => {
  it("writes a handoff targeting session.checkpoint_generation + 1", async () => {
    const result = await handleCheckpointHandoffPrepare(VALID_PARAMS, makeCtx());

    expect(result.success).toBe(true);
    expect(mockWriteHandoff).toHaveBeenCalledWith(
      "sess-1",
      5, // 4 + 1
      expect.objectContaining({
        preserveMd: VALID_PARAMS.preserve_md,
        preferredRecallQuery: VALID_PARAMS.preferred_recall_query,
        importantEntities: ["POLY-0x1234", "mission-42"],
        openLoops: ["Re-check price feed", "Close position if drift > 5%"],
      }),
    );
  });

  it("accepts native arrays for entities/open_loops (not just JSON strings)", async () => {
    const result = await handleCheckpointHandoffPrepare(
      {
        ...VALID_PARAMS,
        important_entities: ["a", "b"],
        open_loops: ["x"],
      },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(mockWriteHandoff).toHaveBeenCalledWith(
      "sess-1",
      5,
      expect.objectContaining({ importantEntities: ["a", "b"], openLoops: ["x"] }),
    );
  });

  it("rejects calls when contextUsageBand === 'normal' (defense in depth)", async () => {
    const result = await handleCheckpointHandoffPrepare(
      VALID_PARAMS,
      makeCtx({ contextUsageBand: "normal" }),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/warning.*critical/);
    expect(mockWriteHandoff).not.toHaveBeenCalled();
  });

  it("allows calls at contextUsageBand === 'critical'", async () => {
    const result = await handleCheckpointHandoffPrepare(
      VALID_PARAMS,
      makeCtx({ contextUsageBand: "critical" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects preserve_md > 2000 chars", async () => {
    const result = await handleCheckpointHandoffPrepare(
      { ...VALID_PARAMS, preserve_md: "x".repeat(2001) },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/preserve_md.*2000/);
  });

  it("rejects empty preferred_recall_query", async () => {
    const result = await handleCheckpointHandoffPrepare(
      { ...VALID_PARAMS, preferred_recall_query: "" },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/preferred_recall_query/);
  });

  it("rejects important_entities with > 20 items", async () => {
    const overflow = JSON.stringify(Array.from({ length: 21 }, (_, i) => `e${i}`));
    const result = await handleCheckpointHandoffPrepare(
      { ...VALID_PARAMS, important_entities: overflow },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/important_entities.*20/);
  });

  it("rejects open_loops items longer than 200 chars", async () => {
    const longLoop = JSON.stringify(["x".repeat(201)]);
    const result = await handleCheckpointHandoffPrepare(
      { ...VALID_PARAMS, open_loops: longLoop },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/open_loops.*200/);
  });

  it("returns a clean error when the session row is missing", async () => {
    mockGetSession.mockResolvedValue(null);
    const result = await handleCheckpointHandoffPrepare(VALID_PARAMS, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found/);
    expect(mockWriteHandoff).not.toHaveBeenCalled();
  });
});
