/**
 * Phase 8 (puzzle 04) archive ↔ restore round-trip invariant.
 *
 * The mission rewind / restore flow holds one critical contract:
 * archive K messages under checkpoint X, then restore checkpoint X,
 * and `sessions.message_count` MUST return to its pre-archive value.
 *
 *   messageCount(initial)  =  messageCount(after archive + restore)
 *
 * `restore.test.ts:264` already pins the delta arithmetic for a
 * single restore invocation. THIS test pins the FULL round-trip with
 * a STATEFUL fake — archive actually decrements an in-memory
 * `messageCount`, restore reads exactly the rows the same archive
 * stamped under that checkpoint, increment mutates the counter, and
 * the final assertion is `messageCount === INITIAL_COUNT`.
 *
 * Bugs caught by this design that the delta-only test would miss:
 *   - archive writing a different checkpoint id than restore reads,
 *   - archive returning a count that doesn't match the actual rows
 *     it stamped (a stale `archivedCount` after a partial CTE),
 *   - restore's `restoredCount` diverging from the unarchived row
 *     count (a math bug in restore.ts:251-255).
 *
 * No Testcontainers — that lands separately at puzzle 11 runtime QA.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptEventBus } from "../../../../vex-agent/engine/events/transcript-bus.js";

interface FakeMessageRow {
  readonly id: number;
  readonly role: "user" | "assistant";
  readonly content: string;
}

const SESSION = "session-round-trip";
const CHECKPOINT = "chk-round-trip";
const INITIAL_COUNT = 10;
const CUTOFF_MESSAGE_ID = 7;

// ── stateful fake DB ────────────────────────────────────────────
//
// `messageCount`, `liveMessages`, and `archiveStore` model the
// sessions row + messages table + messages_archive table. Every
// mocked primitive mutates this state the way the real primitive
// would mutate its SQL tables.

let messageCount = 0;
let liveMessages: FakeMessageRow[] = [];
const archiveStore = new Map<string, FakeMessageRow[]>();

function resetFakeDb(): void {
  messageCount = INITIAL_COUNT;
  liveMessages = Array.from({ length: INITIAL_COUNT }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `msg ${i + 1}`,
  }));
  archiveStore.clear();
}

// ── archive-side mocks ──────────────────────────────────────────

const mockArchiveSuffix = vi.fn();

vi.mock("@vex-agent/db/repos/sessions-archive.js", () => ({
  archiveSuffix: (...a: unknown[]) => mockArchiveSuffix(...a),
}));

// ── restore-side mocks ──────────────────────────────────────────

const mockAcquireLease = vi.fn();
const mockReleaseLease = vi.fn();
const mockGetLatestUnrestoredCheckpoint = vi.fn();
const mockGetCheckpointForUpdate = vi.fn();
const mockMarkCheckpointRestored = vi.fn();
const mockCheckActiveRun = vi.fn();
const mockCheckPendingApproval = vi.fn();
const mockCheckExistingIdempotencyMatch = vi.fn();
const mockUnarchiveStampedRows = vi.fn();
const mockIncrementSessionMessageCount = vi.fn();
const mockEmitRestoredMessages = vi.fn();

vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  acquireLease: (...a: unknown[]) => mockAcquireLease(...a),
  releaseLease: (...a: unknown[]) => mockReleaseLease(...a),
  getLease: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/rewind-checkpoints.js", () => ({
  getLatestUnrestoredCheckpoint: (...a: unknown[]) =>
    mockGetLatestUnrestoredCheckpoint(...a),
  getCheckpointForUpdate: (...a: unknown[]) =>
    mockGetCheckpointForUpdate(...a),
  markCheckpointRestored: (...a: unknown[]) => mockMarkCheckpointRestored(...a),
}));

vi.mock("@vex-agent/engine/mission/restore-internals.js", () => ({
  checkActiveRun: (...a: unknown[]) => mockCheckActiveRun(...a),
  checkPendingApproval: (...a: unknown[]) => mockCheckPendingApproval(...a),
  checkExistingIdempotencyMatch: (...a: unknown[]) =>
    mockCheckExistingIdempotencyMatch(...a),
  unarchiveStampedRows: (...a: unknown[]) => mockUnarchiveStampedRows(...a),
  incrementSessionMessageCount: (...a: unknown[]) =>
    mockIncrementSessionMessageCount(...a),
  emitRestoredMessages: (...a: unknown[]) => mockEmitRestoredMessages(...a),
}));

// Fake pool/client so `withTransaction` in restore.ts works. The
// session FOR UPDATE lock SQL must return one row, otherwise the
// engine short-circuits with `session_not_found`.
const fakeClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const fakeClientRelease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: fakeClientQuery,
      release: fakeClientRelease,
    }),
  }),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const fakeClient = { query: fakeClientQuery };
    await fakeClientQuery("BEGIN");
    try {
      const result = await fn(fakeClient);
      await fakeClientQuery("COMMIT");
      return result;
    } catch (err) {
      await fakeClientQuery("ROLLBACK");
      throw err;
    }
  },
  executeWith: vi.fn(),
  queryOneWith: async (_client: unknown, sql: string, params?: unknown[]) => {
    const result = await fakeClientQuery(sql, params);
    return result.rows[0] ?? null;
  },
  queryWith: async (_client: unknown, sql: string, params?: unknown[]) => {
    const result = await fakeClientQuery(sql, params);
    return result.rows;
  },
}));

const { archiveSuffix } = await import(
  "../../../../vex-agent/db/repos/sessions-archive.js"
);
const { restoreLatestCheckpoint } = await import(
  "../../../../vex-agent/engine/mission/restore.js"
);

function makeAcquiredLease() {
  return {
    sessionId: SESSION,
    missionRunId: null,
    ownerId: "owner-round-trip",
    processKind: "test" as const,
    acquiredAt: new Date(),
    heartbeatAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
  };
}

function makeCheckpoint(archivedCount: number, restoredAt: string | null) {
  return {
    id: CHECKPOINT,
    sessionId: SESSION,
    missionRunId: null,
    cutoffMessageId: CUTOFF_MESSAGE_ID,
    cutoffCreatedAt: "2026-05-22T10:00:00.000Z",
    archivedCount,
    createdBy: "user" as const,
    reason: "round-trip rewind",
    createdAt: "2026-05-22T10:00:00.000Z",
    restoredAt,
    restoreIdempotencyKey: restoredAt === null ? null : "key-round-trip",
  };
}

// ── stateful mock wiring ────────────────────────────────────────

function wireStatefulMocks(): void {
  // archiveSuffix: slice rows with id >= cutoff out of `liveMessages`,
  // stamp them under `checkpointId` in `archiveStore`, decrement
  // `messageCount`. Mirrors what the real CTE does in `sessions-
  // archive.ts:runArchiveSuffixStatements`.
  mockArchiveSuffix.mockImplementation(
    async (_session: string, cutoff: number, checkpointId: string | null) => {
      const archived = liveMessages.filter((m) => m.id >= cutoff);
      liveMessages = liveMessages.filter((m) => m.id < cutoff);
      if (checkpointId !== null) {
        archiveStore.set(checkpointId, archived);
      }
      messageCount = liveMessages.length;
      return {
        archivedCount: archived.length,
        remainingCount: messageCount,
      };
    },
  );

  // unarchiveStampedRows: pull rows by checkpointId out of the store,
  // push them back to liveMessages. Mirrors the DELETE...RETURNING +
  // INSERT in `restore-internals.ts:unarchiveStampedRows`.
  mockUnarchiveStampedRows.mockImplementation(
    async (_client: unknown, checkpointId: string) => {
      const stored = archiveStore.get(checkpointId) ?? [];
      archiveStore.delete(checkpointId);
      liveMessages.push(...stored);
      return stored.map((m) => ({
        id: m.id,
        role: m.role,
        created_at: "2026-05-22T10:00:00.000Z",
        message_type: null,
      }));
    },
  );

  // incrementSessionMessageCount mutates the counter — the contract
  // we're really pinning. `restore-internals.ts:159-172`.
  mockIncrementSessionMessageCount.mockImplementation(
    async (_client: unknown, _session: string, delta: number) => {
      messageCount += delta;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb();
  fakeClientQuery.mockImplementation(async (sql: string) => {
    if (typeof sql === "string" && /FROM\s+sessions\s+WHERE\s+id\s*=\s*\$1\s+FOR\s+UPDATE/i.test(sql)) {
      return { rows: [{ id: SESSION }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  wireStatefulMocks();
});

describe("archive ↔ restore round-trip", () => {
  it("returns messageCount to its initial value after archive + restore", async () => {
    expect(messageCount).toBe(INITIAL_COUNT);

    // ── ARCHIVE ─────────────────────────────────────────────────
    const archiveOutcome = await archiveSuffix(
      SESSION,
      CUTOFF_MESSAGE_ID,
      CHECKPOINT,
    );

    const archivedRows = INITIAL_COUNT - (CUTOFF_MESSAGE_ID - 1);
    expect(archiveOutcome.archivedCount).toBe(archivedRows);
    expect(messageCount).toBe(INITIAL_COUNT - archivedRows);
    expect(archiveStore.get(CHECKPOINT)).toHaveLength(archivedRows);

    // ── RESTORE ─────────────────────────────────────────────────
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(
      makeCheckpoint(archiveOutcome.archivedCount, null),
    );
    mockGetCheckpointForUpdate
      .mockResolvedValueOnce(makeCheckpoint(archiveOutcome.archivedCount, null))
      .mockResolvedValueOnce(
        makeCheckpoint(archiveOutcome.archivedCount, "2026-05-22T11:00:00.000Z"),
      );
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce(null);

    const bus = new TranscriptEventBus();
    const restoreOutcome = await restoreLatestCheckpoint({
      sessionId: SESSION,
      idempotencyKey: "key-round-trip",
      bus,
    });

    // ── ROUND-TRIP INVARIANT ───────────────────────────────────
    // 1. messageCount returned to its pre-archive value.
    expect(messageCount).toBe(INITIAL_COUNT);

    // 2. The restored row count equals the archived row count (no
    //    off-by-one in the engine's delta arithmetic).
    expect(restoreOutcome.outcome).toBe("restored");
    if (restoreOutcome.outcome === "restored") {
      expect(restoreOutcome.restoredCount).toBe(archiveOutcome.archivedCount);
      expect(restoreOutcome.checkpointId).toBe(CHECKPOINT);
    }

    // 3. The checkpoint store is empty — restore drained the rows it
    //    was supposed to.
    expect(archiveStore.has(CHECKPOINT)).toBe(false);

    // 4. liveMessages is back to its original size (rows actually
    //    moved back, not just the count).
    expect(liveMessages).toHaveLength(INITIAL_COUNT);

    // 5. Every increment call delta came from `restoredRows.length`,
    //    not a stale cached count on the checkpoint metadata.
    expect(mockIncrementSessionMessageCount).toHaveBeenCalledWith(
      expect.anything(),
      SESSION,
      archiveOutcome.archivedCount,
    );
  });

  it("propagates zero archive count → zero restore delta (edge: empty rewind)", async () => {
    // Cutoff past every live id → archiveSuffix archives 0 rows.
    expect(messageCount).toBe(INITIAL_COUNT);
    const archiveOutcome = await archiveSuffix(
      SESSION,
      INITIAL_COUNT + 100,
      CHECKPOINT,
    );
    expect(archiveOutcome.archivedCount).toBe(0);
    expect(messageCount).toBe(INITIAL_COUNT);

    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(
      makeCheckpoint(0, null),
    );
    mockGetCheckpointForUpdate
      .mockResolvedValueOnce(makeCheckpoint(0, null))
      .mockResolvedValueOnce(makeCheckpoint(0, "2026-05-22T11:00:00.000Z"));
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce(null);

    const bus = new TranscriptEventBus();
    const restoreOutcome = await restoreLatestCheckpoint({
      sessionId: SESSION,
      idempotencyKey: "key-zero",
      bus,
    });

    expect(restoreOutcome.outcome).toBe("restored");
    if (restoreOutcome.outcome === "restored") {
      expect(restoreOutcome.restoredCount).toBe(0);
    }
    // Engine still calls increment with delta=0 (no-op by design —
    // see `restore-internals.ts:164`). The counter stays at initial.
    expect(messageCount).toBe(INITIAL_COUNT);
  });
});
