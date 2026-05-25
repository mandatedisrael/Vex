/**
 * approval-intents repo — unit tests (mocked pool + scripted PoolClient).
 *
 * Puzzle 5 phase 2 (2026-05-23). Pins:
 *   - INSERT SQL shape (column count + order match migration 024)
 *   - JSONB columns serialized via `jsonb(...)` (not raw object)
 *   - `createWith(client, ...)` writes through the supplied PoolClient (tx
 *     wrap), not the pool — required for atomic queue+intent+mission tx
 *   - row mapper honors the 16 schema columns + default `not_started`
 *     execution status for phase-2-era rows
 *   - getPendingForSession JOINs approval_queue + filters pending status
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

interface QueryCall {
  sql: string;
  params: unknown[] | undefined;
}

const clientQueryLog: QueryCall[] = [];

const mockClient = {
  async query(sql: string, params?: unknown[]) {
    clientQueryLog.push({ sql, params });
    return { rows: [] };
  },
};

type PoolQueryMock = Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>;
type PoolQueryOneMock = Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>;

let mockPoolQuery: PoolQueryMock;
let mockPoolQueryOne: PoolQueryOneMock;

function resetMocks() {
  clientQueryLog.length = 0;
  mockPoolQuery = vi.fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValue([]);
  mockPoolQueryOne = vi.fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>()
    .mockResolvedValue(null);
}

let mockPoolExecute: Mock<(sql: string, params?: unknown[]) => Promise<number>>;
function resetExecuteMock() {
  mockPoolExecute = vi.fn<(sql: string, params?: unknown[]) => Promise<number>>()
    .mockResolvedValue(1);
}
resetExecuteMock();

vi.mock("@vex-agent/db/client.js", () => ({
  query: (sql: string, params?: unknown[]) => mockPoolQuery(sql, params),
  queryOne: (sql: string, params?: unknown[]) => mockPoolQueryOne(sql, params),
  execute: (sql: string, params?: unknown[]) => mockPoolExecute(sql, params),
  queryWith: vi.fn(),
  queryOneWith: vi.fn(),
  executeWith: vi.fn(),
}));

resetMocks();

const intents = await import("@vex-agent/db/repos/approval-intents.js");

beforeEach(() => {
  resetMocks();
  resetExecuteMock();
});

// ── Fixtures ────────────────────────────────────────────────────────────

const APPROVAL_ID = "approval-test-001";
const SESSION_ID = "00000000-0000-4000-8000-00000000bbbb";
const MISSION_RUN_ID = "run-abc-123";
const TOOL_CALL_ID = "call_xyz";

function makeCreateInput(): intents.CreateIntentInput {
  return {
    approvalId: APPROVAL_ID,
    sessionId: SESSION_ID,
    missionRunId: MISSION_RUN_ID,
    toolCallId: TOOL_CALL_ID,
    actionKind: "user_wallet_broadcast",
    riskLevel: "high",
    previewJson: { toolName: "wallet_send_confirm", criticalArgs: { to: "0xabc", amount: "1.0" } },
    policyJson: { permission: "restricted", sessionKind: "mission", missionRunActive: true, contextUsageBand: "normal" },
  };
}

// ── createWith ─────────────────────────────────────────────────────────

describe("createWith", () => {
  it("INSERTs all 10 enqueue-time columns in declared order on the supplied client", async () => {
    await intents.createWith(mockClient as never, makeCreateInput());

    expect(clientQueryLog).toHaveLength(1);
    const { sql, params } = clientQueryLog[0]!;
    expect(sql).toContain("INSERT INTO approval_intents");
    expect(sql).toContain(
      "approval_id, session_id, mission_run_id, tool_call_id,\n  action_kind, risk_level, preview_json, policy_json,\n  expires_at, idempotency_key",
    );
    expect(params).toEqual([
      APPROVAL_ID,
      SESSION_ID,
      MISSION_RUN_ID,
      TOOL_CALL_ID,
      "user_wallet_broadcast",
      "high",
      expect.stringContaining("toolName"), // JSON-stringified preview
      expect.stringContaining("permission"), // JSON-stringified policy
      null, // expires_at default
      null, // idempotency_key default
    ]);
  });

  it("does NOT touch the pool — writes go through the supplied PoolClient", async () => {
    await intents.createWith(mockClient as never, makeCreateInput());
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockPoolQueryOne).not.toHaveBeenCalled();
  });

  it("supports nullable missionRunId / toolCallId (chat-session approval)", async () => {
    await intents.createWith(mockClient as never, {
      ...makeCreateInput(),
      missionRunId: null,
      toolCallId: null,
    });
    const { params } = clientQueryLog[0]!;
    expect(params![2]).toBeNull(); // mission_run_id
    expect(params![3]).toBeNull(); // tool_call_id
  });

  it("forwards explicit expires_at and idempotency_key", async () => {
    await intents.createWith(mockClient as never, {
      ...makeCreateInput(),
      expiresAt: "2026-06-01T00:00:00Z",
      idempotencyKey: "user-approval-12345",
    });
    const { params } = clientQueryLog[0]!;
    expect(params![8]).toBe("2026-06-01T00:00:00Z");
    expect(params![9]).toBe("user-approval-12345");
  });

  it("serializes JSONB columns through `jsonb()` (no raw object passed to SQL)", async () => {
    await intents.createWith(mockClient as never, makeCreateInput());
    const { params } = clientQueryLog[0]!;
    // jsonb() returns a string; raw object would be `[object Object]` after coerce
    expect(typeof params![6]).toBe("string");
    expect(typeof params![7]).toBe("string");
  });
});

// ── getByApprovalId ────────────────────────────────────────────────────

describe("getByApprovalId", () => {
  it("returns null when no row exists", async () => {
    mockPoolQueryOne.mockResolvedValue(null);
    const result = await intents.getByApprovalId(APPROVAL_ID);
    expect(result).toBeNull();
  });

  it("maps a full row to the ApprovalIntent shape", async () => {
    mockPoolQueryOne.mockResolvedValue({
      approval_id: APPROVAL_ID,
      session_id: SESSION_ID,
      mission_run_id: MISSION_RUN_ID,
      tool_call_id: TOOL_CALL_ID,
      action_kind: "user_wallet_broadcast",
      risk_level: "high",
      preview_json: { toolName: "wallet_send_confirm" },
      policy_json: { permission: "restricted" },
      expires_at: null,
      idempotency_key: null,
      created_at: "2026-05-23T20:00:00Z",
      decided_at: null,
      decision: null,
      decision_reason: null,
      execution_status: "not_started",
      execution_result_hash: null,
    });
    const result = await intents.getByApprovalId(APPROVAL_ID);
    expect(result).toEqual({
      approvalId: APPROVAL_ID,
      sessionId: SESSION_ID,
      missionRunId: MISSION_RUN_ID,
      toolCallId: TOOL_CALL_ID,
      actionKind: "user_wallet_broadcast",
      riskLevel: "high",
      previewJson: { toolName: "wallet_send_confirm" },
      policyJson: { permission: "restricted" },
      expiresAt: null,
      idempotencyKey: null,
      createdAt: "2026-05-23T20:00:00Z",
      decidedAt: null,
      decision: null,
      decisionReason: null,
      executionStatus: "not_started",
      executionResultHash: null,
    });
  });

  it("converts TIMESTAMPTZ Date values to ISO-8601 strings", async () => {
    // `pg` driver returns `Date` objects for TIMESTAMPTZ columns, but the
    // repo interface stores them as ISO-8601 strings so the IPC boundary
    // stays scalar. Mirror the pattern from sessions-db / messages repos.
    mockPoolQueryOne.mockResolvedValue({
      approval_id: APPROVAL_ID,
      session_id: SESSION_ID,
      mission_run_id: null,
      tool_call_id: null,
      action_kind: "external_post",
      risk_level: "medium",
      preview_json: {},
      policy_json: {},
      expires_at: new Date("2026-06-01T12:00:00.000Z"),
      idempotency_key: null,
      created_at: new Date("2026-05-23T20:00:00.000Z"),
      decided_at: new Date("2026-05-23T20:05:00.000Z"),
      decision: "approved",
      decision_reason: null,
      execution_status: "succeeded",
      execution_result_hash: "abc123",
    });
    const result = await intents.getByApprovalId(APPROVAL_ID);
    expect(result?.createdAt).toBe("2026-05-23T20:00:00.000Z");
    expect(result?.expiresAt).toBe("2026-06-01T12:00:00.000Z");
    expect(result?.decidedAt).toBe("2026-05-23T20:05:00.000Z");
    // String-typed inputs pass through unchanged.
    expect(typeof result?.createdAt).toBe("string");
    expect(typeof result?.expiresAt).toBe("string");
    expect(typeof result?.decidedAt).toBe("string");
  });

  it("defaults executionStatus to 'not_started' if column is missing (back-compat)", async () => {
    mockPoolQueryOne.mockResolvedValue({
      approval_id: APPROVAL_ID,
      session_id: SESSION_ID,
      mission_run_id: null,
      tool_call_id: null,
      action_kind: "read",
      risk_level: "info",
      preview_json: {},
      policy_json: {},
      expires_at: null,
      idempotency_key: null,
      created_at: "2026-05-23T20:00:00Z",
      decided_at: null,
      decision: null,
      decision_reason: null,
      execution_status: null, // DB defaults this column but tolerate null in map
      execution_result_hash: null,
    });
    const result = await intents.getByApprovalId(APPROVAL_ID);
    expect(result?.executionStatus).toBe("not_started");
  });

  it("uses the approval_id PK in the WHERE clause", async () => {
    mockPoolQueryOne.mockResolvedValue(null);
    await intents.getByApprovalId(APPROVAL_ID);
    expect(mockPoolQueryOne).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQueryOne.mock.calls[0]!;
    expect(sql).toContain("WHERE approval_id = $1");
    expect(params).toEqual([APPROVAL_ID]);
  });
});

// ── markDecisionWith (phase 3) ─────────────────────────────────────────

describe("markDecisionWith", () => {
  it("CAS UPDATE — only fires when decision IS NULL, returns true on rowCount > 0", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ approval_id: APPROVAL_ID }] }),
    };
    const ok = await intents.markDecisionWith(mockClient as never, {
      approvalId: APPROVAL_ID,
      kind: "approved",
      idempotencyKey: APPROVAL_ID,
    });
    expect(ok).toBe(true);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(sql).toContain("UPDATE approval_intents");
    expect(sql).toContain("decision        = $2");
    expect(sql).toContain("AND decision IS NULL");
    expect(sql).toContain("RETURNING approval_id");
    expect(params).toEqual([APPROVAL_ID, "approved", null, APPROVAL_ID]);
  });

  it("returns false when CAS misses (rowCount = 0)", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const ok = await intents.markDecisionWith(mockClient as never, {
      approvalId: APPROVAL_ID,
      kind: "rejected",
      reason: "test",
    });
    expect(ok).toBe(false);
  });

  it("forwards reason + idempotencyKey to the SQL params", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ approval_id: APPROVAL_ID }] }),
    };
    await intents.markDecisionWith(mockClient as never, {
      approvalId: APPROVAL_ID,
      kind: "rejected",
      reason: "expired_ttl",
      idempotencyKey: "custom-key-123",
    });
    const [, params] = mockClient.query.mock.calls[0];
    expect(params).toEqual([APPROVAL_ID, "rejected", "expired_ttl", "custom-key-123"]);
  });
});

// ── markExecutionStatus(With) (phase 3) ────────────────────────────────

describe("markExecutionStatusWith / markExecutionStatus", () => {
  it("markExecutionStatusWith writes status + COALESCE(hash)", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };
    await intents.markExecutionStatusWith(
      mockClient as never,
      APPROVAL_ID,
      "succeeded",
      "abc123",
    );
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockClient.query.mock.calls[0];
    expect(sql).toContain("UPDATE approval_intents");
    expect(sql).toContain("execution_status      = $2");
    expect(sql).toContain("execution_result_hash = COALESCE($3, execution_result_hash)");
    expect(params).toEqual([APPROVAL_ID, "succeeded", "abc123"]);
  });

  it("markExecutionStatusWith passes null hash when omitted (COALESCE preserves existing)", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    };
    await intents.markExecutionStatusWith(
      mockClient as never,
      APPROVAL_ID,
      "dispatching",
    );
    const [, params] = mockClient.query.mock.calls[0];
    expect(params).toEqual([APPROVAL_ID, "dispatching", null]);
  });

  it("markExecutionStatus uses pool execute (non-tx variant)", async () => {
    await intents.markExecutionStatus(APPROVAL_ID, "failed", "deadbeef");
    expect(mockPoolExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolExecute.mock.calls[0];
    expect(sql).toContain("UPDATE approval_intents");
    expect(params).toEqual([APPROVAL_ID, "failed", "deadbeef"]);
  });
});

// ── getExpired (phase 3) ───────────────────────────────────────────────

describe("getExpired", () => {
  it("JOINs queue, filters expires_at < now AND decision IS NULL AND queue.status = 'pending'", async () => {
    mockPoolQuery.mockResolvedValue([]);
    const now = new Date("2026-05-23T20:00:00Z");
    await intents.getExpired(now);

    const [sql, params] = mockPoolQuery.mock.calls[0]!;
    expect(sql).toContain("FROM approval_intents i");
    expect(sql).toContain("JOIN approval_queue q ON q.id = i.approval_id");
    expect(sql).toContain("WHERE i.expires_at IS NOT NULL");
    expect(sql).toContain("AND i.expires_at < $1");
    expect(sql).toContain("AND i.decision IS NULL");
    expect(sql).toContain("AND q.status = 'pending'");
    expect(sql).toContain("ORDER BY i.created_at ASC");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([now.toISOString(), 50]);
  });

  it("accepts custom limit", async () => {
    mockPoolQuery.mockResolvedValue([]);
    await intents.getExpired(new Date(), 200);
    const [, params] = mockPoolQuery.mock.calls[0]!;
    expect(params![1]).toBe(200);
  });

  it("normalises Date input to ISO string", async () => {
    mockPoolQuery.mockResolvedValue([]);
    const now = new Date("2026-05-23T20:00:00.000Z");
    await intents.getExpired(now);
    const [, params] = mockPoolQuery.mock.calls[0]!;
    expect(params![0]).toBe("2026-05-23T20:00:00.000Z");
  });

  it("maps multiple expired rows through the row mapper", async () => {
    mockPoolQuery.mockResolvedValue([
      {
        approval_id: "a-1",
        session_id: SESSION_ID,
        mission_run_id: "run-1",
        tool_call_id: "call-1",
        action_kind: "user_wallet_broadcast",
        risk_level: "high",
        preview_json: {},
        policy_json: {},
        expires_at: new Date("2026-05-23T19:00:00.000Z"),
        idempotency_key: null,
        created_at: new Date("2026-05-23T18:00:00.000Z"),
        decided_at: null,
        decision: null,
        decision_reason: null,
        execution_status: "not_started",
        execution_result_hash: null,
      },
    ]);
    const result = await intents.getExpired(new Date());
    expect(result).toHaveLength(1);
    expect(result[0]!.approvalId).toBe("a-1");
    expect(result[0]!.expiresAt).toBe("2026-05-23T19:00:00.000Z");
  });
});

// ── getPendingForSession ───────────────────────────────────────────────

describe("getPendingForSession", () => {
  it("JOINs approval_queue and filters status = 'pending'", async () => {
    mockPoolQuery.mockResolvedValue([]);
    await intents.getPendingForSession(SESSION_ID);
    const [sql, params] = mockPoolQuery.mock.calls[0]!;
    expect(sql).toContain("FROM approval_intents i");
    expect(sql).toContain("JOIN approval_queue q ON q.id = i.approval_id");
    expect(sql).toContain("WHERE i.session_id = $1 AND q.status = 'pending'");
    expect(sql).toContain("ORDER BY i.created_at ASC");
    expect(params).toEqual([SESSION_ID]);
  });

  it("returns an empty array when no rows", async () => {
    mockPoolQuery.mockResolvedValue([]);
    const result = await intents.getPendingForSession(SESSION_ID);
    expect(result).toEqual([]);
  });

  it("maps multiple rows through the row mapper", async () => {
    mockPoolQuery.mockResolvedValue([
      {
        approval_id: "a-1",
        session_id: SESSION_ID,
        mission_run_id: null,
        tool_call_id: null,
        action_kind: "read",
        risk_level: "info",
        preview_json: {},
        policy_json: {},
        expires_at: null,
        idempotency_key: null,
        created_at: "2026-05-23T20:00:00Z",
        decided_at: null,
        decision: null,
        decision_reason: null,
        execution_status: "not_started",
        execution_result_hash: null,
      },
      {
        approval_id: "a-2",
        session_id: SESSION_ID,
        mission_run_id: MISSION_RUN_ID,
        tool_call_id: TOOL_CALL_ID,
        action_kind: "user_wallet_broadcast",
        risk_level: "high",
        preview_json: { toolName: "wallet_send_confirm" },
        policy_json: { permission: "restricted" },
        expires_at: null,
        idempotency_key: null,
        created_at: "2026-05-23T20:01:00Z",
        decided_at: null,
        decision: null,
        decision_reason: null,
        execution_status: "not_started",
        execution_result_hash: null,
      },
    ]);
    const result = await intents.getPendingForSession(SESSION_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.approvalId).toBe("a-1");
    expect(result[1]!.actionKind).toBe("user_wallet_broadcast");
  });
});
