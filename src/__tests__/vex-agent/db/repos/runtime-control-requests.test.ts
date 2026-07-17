/**
 * Unit tests for the runtime-control-requests repo. Pool is mocked; no DB.
 *
 * Scripted-client pattern matches `loop-wake.test.ts` for consistency:
 * assert the SQL sent to the mocked pool and the params it carries.
 *
 * Focus: WP5 fix — `enqueueRequest`'s `initialStatus` opt-in. A
 * `cancel_wake` audit row for a control action already applied
 * synchronously must be inserted already `'cleared'` (with `cleared_at`
 * set in the SAME statement) instead of `'pending'`, because nothing ever
 * observes/clears a `cancel_wake` row and a stranded pending row makes the
 * kind-agnostic `pending_control_kind` lookup treat the session as
 * permanently busy.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

type PoolQueryOneMock = Mock<
  (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>
>;

let mockQueryOneWith: PoolQueryOneMock;

function makeQueryOneWithMock(): PoolQueryOneMock {
  return vi
    .fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>()
    .mockResolvedValue(null);
}

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({}),
  queryOneWith: (_exec: unknown, sql: string, params?: unknown[]) =>
    mockQueryOneWith(sql, params),
  executeWith: vi.fn(),
  queryWith: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
}));

mockQueryOneWith = makeQueryOneWithMock();

const repo = await import("@vex-agent/db/repos/runtime-control-requests.js");

const SESSION = "session-abc";
const NOW = new Date("2026-07-17T10:00:00.000Z");

function makeRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    session_id: SESSION,
    mission_run_id: null,
    kind: "cancel_wake",
    status: "pending",
    requested_by: "user",
    reason: null,
    correlation_id: null,
    created_at: NOW,
    observed_at: null,
    cleared_at: null,
    expires_at: null,
    ...overrides,
  };
}

describe("runtime-control-requests repo — enqueueRequest", () => {
  beforeEach(() => {
    mockQueryOneWith = makeQueryOneWithMock();
  });

  it("defaults to a pending row (existing callers unaffected)", async () => {
    mockQueryOneWith.mockResolvedValueOnce(makeRow());
    const result = await repo.enqueueRequest({
      sessionId: SESSION,
      kind: "pause_after_step",
      requestedBy: "user",
    });

    expect(result.status).toBe("pending");
    expect(result.clearedAt).toBeNull();

    const [sql, params] = mockQueryOneWith.mock.calls[0];
    expect(sql).toContain("INSERT INTO runtime_control_requests");
    expect(sql).toContain(
      "(session_id, mission_run_id, kind, requested_by, reason, correlation_id, expires_at, status, cleared_at)",
    );
    expect(sql).toContain("CASE WHEN $8 = 'cleared' THEN NOW() ELSE NULL END");
    // Positional params: sessionId, missionRunId, kind, requestedBy, reason,
    // correlationId, expiresAt, status — status defaults to 'pending'.
    expect(params).toEqual([SESSION, null, "pause_after_step", "user", null, null, null, "pending"]);
  });

  it("inserts a cancel_wake row already 'cleared' with cleared_at set, single statement", async () => {
    mockQueryOneWith.mockResolvedValueOnce(
      makeRow({ status: "cleared", cleared_at: NOW }),
    );
    const result = await repo.enqueueRequest({
      sessionId: SESSION,
      kind: "cancel_wake",
      requestedBy: "user",
      correlationId: "req-1",
      reason: "cancelled=1",
      initialStatus: "cleared",
    });

    expect(result.status).toBe("cleared");
    expect(result.clearedAt).not.toBeNull();

    // Single INSERT — no follow-up UPDATE against the mocked pool.
    expect(mockQueryOneWith).toHaveBeenCalledTimes(1);
    const [, params] = mockQueryOneWith.mock.calls[0];
    expect(params?.[7]).toBe("cleared");
  });

  it("passes 'pending' explicitly through the same param slot when initialStatus is omitted", async () => {
    mockQueryOneWith.mockResolvedValueOnce(makeRow({ kind: "stop_terminal" }));
    await repo.enqueueRequest({
      sessionId: SESSION,
      kind: "stop_terminal",
      requestedBy: "system",
    });
    const [, params] = mockQueryOneWith.mock.calls[0];
    expect(params?.[7]).toBe("pending");
  });
});
