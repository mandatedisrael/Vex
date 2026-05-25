/**
 * wallet-intents repo — puzzle 5 phase 4 unit tests (mocked pool).
 *
 * Pins:
 *   - INSERT shape (11 params order matches migration 025 columns)
 *   - getById session_id predicate
 *   - consumeIfPending CAS predicate: status='pending' AND expires_at > NOW
 *     AND session_id (cross-session race-safe)
 *   - markExecuted / markFailed / markAuditFailed session_id predicate +
 *     status='consuming' precondition
 *   - cancelIfPending CAS predicate: status='pending' AND session_id
 *   - getPendingForSession session-scoped listing
 *   - TIMESTAMPTZ Date → ISO normalisation
 *   - rowCount=0 returns null (NEVER silent success)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

type PoolQueryOneMock = Mock<
  (sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>
>;
type PoolQueryMock = Mock<
  (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
>;
type PoolExecuteMock = Mock<
  (sql: string, params?: unknown[]) => Promise<number>
>;

let mockQueryOne: PoolQueryOneMock;
let mockQuery: PoolQueryMock;
let mockExecute: PoolExecuteMock;

function resetMocks() {
  mockQueryOne = vi
    .fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown> | null>>()
    .mockResolvedValue(null);
  mockQuery = vi
    .fn<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>()
    .mockResolvedValue([]);
  mockExecute = vi
    .fn<(sql: string, params?: unknown[]) => Promise<number>>()
    .mockResolvedValue(1);
}
resetMocks();

vi.mock("@vex-agent/db/client.js", () => ({
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  queryOne: (sql: string, params?: unknown[]) => mockQueryOne(sql, params),
  execute: (sql: string, params?: unknown[]) => mockExecute(sql, params),
  queryWith: vi.fn(),
  queryOneWith: vi.fn(),
  executeWith: vi.fn(),
}));

const repo = await import("@vex-agent/db/repos/wallet-intents.js");

beforeEach(() => {
  resetMocks();
});

// ── Fixtures ────────────────────────────────────────────────────────────

const INTENT_ID = "intent-test-001";
const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const WALLET_ADDR = "0xabcdef1234567890abcdef1234567890abcdef12";
const TO_ADDR = "0xfedcba0987654321fedcba0987654321fedcba09";
const EXPIRES_AT = "2026-05-25T10:00:00.000Z";

function fullRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    intent_id: INTENT_ID,
    session_id: SESSION_ID,
    wallet_address: WALLET_ADDR,
    network: "eip155",
    chain_alias: "base",
    to_address: TO_ADDR,
    amount: "1.5",
    token: null,
    preview_json: { label: "test", criticalArgs: {} },
    status: "pending",
    expires_at: EXPIRES_AT,
    consumed_at: null,
    cancelled_at: null,
    tx_hash: null,
    failure_reason: null,
    idempotency_key: INTENT_ID,
    created_at: "2026-05-24T20:00:00.000Z",
    ...overrides,
  };
}

function buildCreateInput(overrides: Partial<repo.CreateInput> = {}): repo.CreateInput {
  return {
    intentId: INTENT_ID,
    sessionId: SESSION_ID,
    walletAddress: WALLET_ADDR,
    network: "eip155",
    chainAlias: "base",
    toAddress: TO_ADDR,
    amount: "1.5",
    token: null,
    previewJson: { label: "Send 1.5 native to 0xfed…cba09 on base", criticalArgs: {} },
    expiresAt: EXPIRES_AT,
    idempotencyKey: INTENT_ID,
    ...overrides,
  };
}

// ── create ──────────────────────────────────────────────────────────────

describe("create", () => {
  it("INSERTs 11 columns in declared order matching migration 025", async () => {
    await repo.create(buildCreateInput());
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO wallet_intents");
    expect(sql).toContain(
      "intent_id, session_id, wallet_address, network, chain_alias,\n  to_address, amount, token, preview_json, expires_at, idempotency_key",
    );
    expect(params).toEqual([
      INTENT_ID,
      SESSION_ID,
      WALLET_ADDR,
      "eip155",
      "base",
      TO_ADDR,
      "1.5",
      null,
      expect.stringContaining("label"), // JSON-serialised preview
      EXPIRES_AT,
      INTENT_ID,
    ]);
  });

  it("preserves null chain_alias / token for Solana native intent", async () => {
    await repo.create(buildCreateInput({
      network: "solana",
      chainAlias: null,
      token: null,
    }));
    const [, params] = mockExecute.mock.calls[0]!;
    expect(params![3]).toBe("solana");
    expect(params![4]).toBeNull();
    expect(params![7]).toBeNull();
  });
});

// ── getById ─────────────────────────────────────────────────────────────

describe("getById", () => {
  it("SELECTs with session_id predicate (cross-session lookup MUST miss)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await repo.getById(INTENT_ID, SESSION_ID);
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("FROM wallet_intents");
    expect(sql).toContain("WHERE intent_id = $1 AND session_id = $2");
    expect(params).toEqual([INTENT_ID, SESSION_ID]);
  });

  it("returns null when row missing", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await repo.getById(INTENT_ID, SESSION_ID);
    expect(result).toBeNull();
  });

  it("maps a full row to WalletIntent shape", async () => {
    mockQueryOne.mockResolvedValueOnce(fullRow());
    const intent = await repo.getById(INTENT_ID, SESSION_ID);
    expect(intent).toEqual({
      intentId: INTENT_ID,
      sessionId: SESSION_ID,
      walletAddress: WALLET_ADDR,
      network: "eip155",
      chainAlias: "base",
      toAddress: TO_ADDR,
      amount: "1.5",
      token: null,
      previewJson: { label: "test", criticalArgs: {} },
      status: "pending",
      expiresAt: EXPIRES_AT,
      consumedAt: null,
      cancelledAt: null,
      txHash: null,
      failureReason: null,
      idempotencyKey: INTENT_ID,
      createdAt: "2026-05-24T20:00:00.000Z",
    });
  });

  it("normalises Date columns to ISO strings for DB timestamp values", async () => {
    mockQueryOne.mockResolvedValueOnce(
      fullRow({
        expires_at: new Date("2026-05-25T10:00:00.000Z"),
        consumed_at: new Date("2026-05-25T09:00:00.000Z"),
        cancelled_at: null,
        created_at: new Date("2026-05-24T20:00:00.000Z"),
      }),
    );
    const intent = await repo.getById(INTENT_ID, SESSION_ID);
    expect(intent?.expiresAt).toBe("2026-05-25T10:00:00.000Z");
    expect(intent?.consumedAt).toBe("2026-05-25T09:00:00.000Z");
    expect(intent?.createdAt).toBe("2026-05-24T20:00:00.000Z");
    expect(typeof intent?.expiresAt).toBe("string");
  });
});

// ── consumeIfPending (CAS) ──────────────────────────────────────────────

describe("consumeIfPending", () => {
  it("CAS UPDATE with status='pending' AND session_id AND expires_at predicates", async () => {
    mockQueryOne.mockResolvedValueOnce(fullRow({ status: "consuming" }));
    await repo.consumeIfPending(INTENT_ID, SESSION_ID);
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("UPDATE wallet_intents");
    expect(sql).toContain("SET status = 'consuming', consumed_at = NOW()");
    expect(sql).toContain("WHERE intent_id = $1");
    expect(sql).toContain("AND session_id = $2");
    expect(sql).toContain("AND status = 'pending'");
    expect(sql).toContain("AND expires_at > NOW()");
    expect(sql).toContain("RETURNING");
    expect(params).toEqual([INTENT_ID, SESSION_ID]);
  });

  it("returns null when CAS misses (rowCount=0 NEVER silent success)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await repo.consumeIfPending(INTENT_ID, SESSION_ID);
    expect(result).toBeNull();
  });

  it("returns mapped WalletIntent with status='consuming' on CAS win", async () => {
    mockQueryOne.mockResolvedValueOnce(fullRow({ status: "consuming", consumed_at: new Date() }));
    const intent = await repo.consumeIfPending(INTENT_ID, SESSION_ID);
    expect(intent?.status).toBe("consuming");
    expect(intent?.consumedAt).not.toBeNull();
  });
});

// ── markExecuted ────────────────────────────────────────────────────────

describe("markExecuted", () => {
  it("CAS UPDATE WHERE status='consuming' AND session_id, writes tx_hash", async () => {
    mockQueryOne.mockResolvedValueOnce(
      fullRow({ status: "executed", tx_hash: "0xtx" }),
    );
    await repo.markExecuted(INTENT_ID, SESSION_ID, "0xtx");
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("SET status = 'executed', tx_hash = $3");
    expect(sql).toContain("AND session_id = $2");
    expect(sql).toContain("AND status = 'consuming'");
    expect(params).toEqual([INTENT_ID, SESSION_ID, "0xtx"]);
  });

  it("returns null when CAS misses (race lost)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await repo.markExecuted(INTENT_ID, SESSION_ID, "0xtx");
    expect(result).toBeNull();
  });
});

// ── markFailed ──────────────────────────────────────────────────────────

describe("markFailed", () => {
  it("writes failure_reason + optional tx_hash + status='failed' WHERE status='consuming' AND session_id", async () => {
    mockQueryOne.mockResolvedValueOnce(
      fullRow({ status: "failed", failure_reason: "TypeError:abc123" }),
    );
    await repo.markFailed(INTENT_ID, SESSION_ID, "TypeError:abc123", "0xtx");
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("SET status = 'failed', failure_reason = $3, tx_hash = $4");
    expect(sql).toContain("AND status = 'consuming'");
    expect(params).toEqual([INTENT_ID, SESSION_ID, "TypeError:abc123", "0xtx"]);
  });

  it("accepts null tx_hash for pre-broadcast failures", async () => {
    mockQueryOne.mockResolvedValueOnce(fullRow({ status: "failed" }));
    await repo.markFailed(INTENT_ID, SESSION_ID, "InsufficientBalance:def456");
    const [, params] = mockQueryOne.mock.calls[0]!;
    expect(params![3]).toBeNull();
  });
});

// ── markAuditFailed ─────────────────────────────────────────────────────

describe("markAuditFailed", () => {
  it("writes status='audit_failed' + tx_hash + reason WHERE status='consuming' (distinct from failed)", async () => {
    mockQueryOne.mockResolvedValueOnce(
      fullRow({ status: "audit_failed", tx_hash: "0xtx" }),
    );
    await repo.markAuditFailed(INTENT_ID, SESSION_ID, "0xtx", "DbError:xyz");
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("SET status = 'audit_failed', tx_hash = $3, failure_reason = $4");
    expect(sql).toContain("AND session_id = $2");
    expect(sql).toContain("AND status = 'consuming'");
    expect(params).toEqual([INTENT_ID, SESSION_ID, "0xtx", "DbError:xyz"]);
  });
});

// ── cancelIfPending (CAS) ───────────────────────────────────────────────

describe("cancelIfPending", () => {
  it("CAS UPDATE WHERE status='pending' AND session_id, sets status='cancelled' + cancelled_at", async () => {
    mockQueryOne.mockResolvedValueOnce(fullRow({ status: "cancelled" }));
    await repo.cancelIfPending(INTENT_ID, SESSION_ID);
    const [sql, params] = mockQueryOne.mock.calls[0]!;
    expect(sql).toContain("SET status = 'cancelled', cancelled_at = NOW()");
    expect(sql).toContain("AND session_id = $2");
    expect(sql).toContain("AND status = 'pending'");
    expect(params).toEqual([INTENT_ID, SESSION_ID]);
  });

  it("returns null when CAS misses (already terminal OR cross-session)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await repo.cancelIfPending(INTENT_ID, SESSION_ID);
    expect(result).toBeNull();
  });
});

// ── getPendingForSession ────────────────────────────────────────────────

describe("getPendingForSession", () => {
  it("SELECT WHERE session_id AND status='pending' ORDER BY created_at ASC", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await repo.getPendingForSession(SESSION_ID);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain("FROM wallet_intents");
    expect(sql).toContain("WHERE session_id = $1 AND status = 'pending'");
    expect(sql).toContain("ORDER BY created_at ASC");
    expect(params).toEqual([SESSION_ID]);
  });

  it("maps multiple rows through the row mapper", async () => {
    mockQuery.mockResolvedValueOnce([
      fullRow({ intent_id: "intent-a" }),
      fullRow({ intent_id: "intent-b", network: "solana", chain_alias: null }),
    ]);
    const results = await repo.getPendingForSession(SESSION_ID);
    expect(results).toHaveLength(2);
    expect(results[0]!.intentId).toBe("intent-a");
    expect(results[1]!.network).toBe("solana");
  });
});
