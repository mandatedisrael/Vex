/**
 * Tests for `supersedeEntry` — the transactional supersede path.
 *
 * We mock the pool `client` (pg.PoolClient) instead of the `execute/queryOne/query`
 * helpers used by the other knowledge tests, because supersedeEntry drives a
 * transaction via `pool.connect()` and issues its own `BEGIN/COMMIT/ROLLBACK`.
 *
 * The mock script array lets each test declare the exact sequence of queries
 * the client is expected to issue. If a test issues more or fewer queries than
 * scripted, we'd notice through the `queryLog` shape check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import pg from "pg";

interface QueryScriptStep {
  /** Matcher on SQL: substring OR regex OR "exact" literal (for BEGIN/COMMIT/ROLLBACK). */
  sqlMatch: string | RegExp;
  /** Rows to return (single or multi). */
  rows?: Record<string, unknown>[];
  /** Throw instead of returning (to simulate pg errors). */
  throw?: Error;
}

const queryScript: QueryScriptStep[] = [];
const queryLog: { sql: string; params: unknown[] | undefined }[] = [];
const clientReleaseSpy = vi.fn();

function resetScript() {
  queryScript.length = 0;
  queryLog.length = 0;
  clientReleaseSpy.mockClear();
}

const mockClient = {
  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    queryLog.push({ sql, params });
    const step = queryScript.shift();
    if (!step) {
      throw new Error(`unexpected query (no script step left): ${sql.slice(0, 80)}`);
    }
    const sqlNorm = sql.trim();
    const matches =
      step.sqlMatch instanceof RegExp
        ? step.sqlMatch.test(sqlNorm)
        : sqlNorm.includes(step.sqlMatch);
    if (!matches) {
      throw new Error(
        `query mismatch: expected ${String(step.sqlMatch)}, got: ${sqlNorm.slice(0, 160)}`,
      );
    }
    if (step.throw) throw step.throw;
    return { rows: step.rows ?? [] };
  },
  release: () => clientReleaseSpy(),
};

const mockConnect = vi.fn(async () => mockClient);

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({ connect: mockConnect }),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

const { supersedeEntry, SupersedeError } = await import(
  "@vex-agent/db/repos/knowledge-lifecycle.js"
);

const SAMPLE_HASH_OLD = "a".repeat(64);
const SAMPLE_HASH_NEW = "b".repeat(64);

const activePredRow = {
  id: 7,
  kind: "risk_rule",
  title: "cap 10%",
  summary: "pos size ≤ 10%",
  content_md: "pos size ≤ 10%",
  tags: [],
  source_refs: {},
  confidence: null,
  status: "active",
  pinned: false,
  valid_from: "2026-04-01T00:00:00Z",
  valid_until: null,
  content_hash: SAMPLE_HASH_OLD,
  embedding_model: "ai/embeddinggemma:300M-Q8_0",
  embedding_dim: 768,
  source_surface: "vex_agent",
  source_session: null,
  supersedes_id: null,
  status_reason: null,
  change_summary: null,
  what_failed: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    previousId: 7,
    kind: "risk_rule",
    title: "cap 5%",
    summary: "pos size ≤ 5%",
    contentMd: "pos size ≤ 5%",
    tags: [],
    sourceRefs: {},
    confidence: null,
    pinned: false,
    validUntil: null,
    contentHash: SAMPLE_HASH_NEW,
    embeddingModel: "ai/embeddinggemma:300M-Q8_0",
    embeddingDim: 768,
    embedding: Array.from({ length: 768 }, () => 0.1),
    reason: "drawdown Q1",
    changeSummary: "tightened from 10% to 5%",
    whatFailed: "3/24 days hit >7%",
    ...overrides,
  };
}

beforeEach(() => {
  resetScript();
  mockConnect.mockClear();
});

describe("supersedeEntry — happy path", () => {
  it("locks predecessor, inserts successor, flips predecessor, commits", async () => {
    const successorRow = {
      ...activePredRow,
      id: 42,
      title: "cap 5%",
      summary: "pos size ≤ 5%",
      content_md: "pos size ≤ 5%",
      content_hash: SAMPLE_HASH_NEW,
      supersedes_id: 7,
      change_summary: "tightened from 10% to 5%",
      what_failed: "3/24 days hit >7%",
    };
    const predAfter = { ...activePredRow, status: "superseded", status_reason: "drawdown Q1" };

    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      // content_hash collision check (against any other row)
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      // existing successor belt-and-braces check
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [] },
      { sqlMatch: "INSERT INTO knowledge_entries", rows: [successorRow] },
      { sqlMatch: "UPDATE knowledge_entries", rows: [predAfter] },
      { sqlMatch: "COMMIT" },
    );

    const result = await supersedeEntry(makeInput());

    expect(result.successor.id).toBe(42);
    expect(result.successor.supersedesId).toBe(7);
    expect(result.successor.changeSummary).toBe("tightened from 10% to 5%");
    expect(result.successor.whatFailed).toBe("3/24 days hit >7%");
    expect(result.predecessor.status).toBe("superseded");
    expect(result.predecessor.statusReason).toBe("drawdown Q1");
    expect(clientReleaseSpy).toHaveBeenCalledTimes(1);
    expect(queryScript.length).toBe(0);
  });
});

describe("supersedeEntry — rejections", () => {
  it("predecessor not found → SupersedeError(code=predecessor_not_found) + ROLLBACK", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput({ previousId: 999 })).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    expect((err as InstanceType<typeof SupersedeError>).code).toBe("predecessor_not_found");
    expect(clientReleaseSpy).toHaveBeenCalledTimes(1);
  });

  it("predecessor already superseded → SupersedeError(code=predecessor_already_superseded) + successor id", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [{ ...activePredRow, status: "superseded" }] },
      // successor reverse-lookup
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [{ id: 55 }] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    const se = err as InstanceType<typeof SupersedeError>;
    expect(se.code).toBe("predecessor_already_superseded");
    expect(se.details.supersededBy).toBe(55);
    expect(se.message).toMatch(/superseded by 55/);
  });

  it("predecessor invalidated/archived → code=predecessor_not_active", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [{ ...activePredRow, status: "invalidated" }] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    expect((err as InstanceType<typeof SupersedeError>).code).toBe("predecessor_not_active");
  });

  it("identical content (hash matches predecessor) → code=identical_content, no INSERT", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(
      makeInput({ contentHash: SAMPLE_HASH_OLD }),
    ).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    expect((err as InstanceType<typeof SupersedeError>).code).toBe("identical_content");
    // Verify we never reached the INSERT.
    expect(queryLog.some((q) => q.sql.includes("INSERT INTO"))).toBe(false);
  });

  it("content_hash collides with an unrelated row → code=content_hash_collision", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      // Another row exists with same content_hash (status irrelevant).
      { sqlMatch: /WHERE content_hash = \$1/, rows: [{ id: 99, status: "archived" }] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    const se = err as InstanceType<typeof SupersedeError>;
    expect(se.code).toBe("content_hash_collision");
    expect(se.details.collidingId).toBe(99);
  });

  it("existing successor despite predecessor.status=active (racy edge) → code=predecessor_already_superseded", async () => {
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [{ id: 77 }] },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    expect((err as InstanceType<typeof SupersedeError>).code).toBe("predecessor_already_superseded");
  });

  it("invalid previous_id (0/NaN/<0) rejects before opening a transaction", async () => {
    for (const bad of [0, -1, Number.NaN]) {
      const err = await supersedeEntry(makeInput({ previousId: bad })).catch((e: Error) => e);
      expect(err).toBeInstanceOf(SupersedeError);
    }
    // connect is never called for bad ids — the function short-circuits.
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("embedding length ≠ embeddingDim → plain Error before transaction", async () => {
    const err = await supersedeEntry(
      makeInput({ embedding: Array.from({ length: 128 }, () => 0.1), embeddingDim: 768 }),
    ).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SupersedeError);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe("supersedeEntry — concurrency belt-and-braces", () => {
  it("race-lost partial unique violation (23505) inside tx → mapped to predecessor_already_superseded", async () => {
    const dbErr = new pg.DatabaseError("duplicate key value violates unique constraint", 0, "error");
    dbErr.code = "23505";
    dbErr.constraint = "idx_ke_supersedes_id";

    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [] },
      { sqlMatch: "INSERT INTO knowledge_entries", throw: dbErr },
      { sqlMatch: "ROLLBACK" },
    );

    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    const se = err as InstanceType<typeof SupersedeError>;
    expect(se.code).toBe("predecessor_already_superseded");
    expect(se.details.pgConstraint).toBe("idx_ke_supersedes_id");
  });

  it("race-lost 23505 on content_hash constraint → mapped to content_hash_collision", async () => {
    const dbErr = new pg.DatabaseError("duplicate key value violates unique constraint", 0, "error");
    dbErr.code = "23505";
    dbErr.constraint = "idx_ke_content_hash";

    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [] },
      { sqlMatch: "INSERT INTO knowledge_entries", throw: dbErr },
      { sqlMatch: "ROLLBACK" },
    );

    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(SupersedeError);
    const se = err as InstanceType<typeof SupersedeError>;
    expect(se.code).toBe("content_hash_collision");
    expect(se.details.pgConstraint).toBe("idx_ke_content_hash");
    // Verify the message does NOT say "superseded" — that would be the #2 audit bug.
    expect(se.message).not.toMatch(/superseded/i);
  });

  it("23505 with unknown constraint name → rethrown verbatim (not masked as SupersedeError)", async () => {
    const dbErr = new pg.DatabaseError("duplicate key value violates unique constraint", 0, "error");
    dbErr.code = "23505";
    dbErr.constraint = "some_future_constraint";

    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [] },
      { sqlMatch: "INSERT INTO knowledge_entries", throw: dbErr },
      { sqlMatch: "ROLLBACK" },
    );

    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    // Unknown UNIQUE — don't lie. Rethrow the original pg error as-is.
    expect(err).toBe(dbErr);
    expect(err).not.toBeInstanceOf(SupersedeError);
  });

  it("non-23505 DB error is rethrown as-is (not swallowed)", async () => {
    const dbErr = new Error("connection terminated unexpectedly");
    queryScript.push(
      { sqlMatch: "BEGIN" },
      { sqlMatch: "FOR UPDATE", rows: [activePredRow] },
      { sqlMatch: /WHERE content_hash = \$1/, rows: [] },
      { sqlMatch: /WHERE supersedes_id = \$1/, rows: [] },
      { sqlMatch: "INSERT INTO knowledge_entries", throw: dbErr },
      { sqlMatch: "ROLLBACK" },
    );
    const err = await supersedeEntry(makeInput()).catch((e: Error) => e);
    expect(err).toBe(dbErr);
    expect(err).not.toBeInstanceOf(SupersedeError);
  });
});
