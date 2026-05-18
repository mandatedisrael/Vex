/**
 * PR3-telemetry — structured-event surface for compact lifecycle, Track 2
 * worker, memory, knowledge, heartbeat, resume packet, and band-pressure
 * observation.
 *
 * The tests fall into three layers:
 *
 * 1. **Pure unit** (`createBandObserver`, `shouldEmitHeartbeatFailure`) —
 *    no mocks, exercises the decision logic in isolation.
 * 2. **Handler unit** — mocks the data-access layer for each tool handler
 *    and asserts the new logger event fires at the correct boundary with
 *    the right payload keys. `vi.spyOn(logger, ...)` + `mockImplementation`
 *    + `mockRestore` mirrors the established pattern in
 *    `knowledge-import/lease-suite.ts:22`.
 * 3. **Naming-consistency lint** — file walker over runtime sources that
 *    asserts no event ever drifts to an underscore namespace. Existing
 *    surface is `compact.*` / `compact-worker.*` / `knowledge.write.*` /
 *    `knowledge.supersede.*` / `memory_recall.*` / `mark_outstanding_resolved.*`.
 *    Banned variants are listed in `BANNED_EVENT_PATTERNS` below.
 *
 * Events that fire deep inside the turn-loop or executor flow
 * (`compact-worker.completed`, `compact.resume_packet.rendered`,
 * `compact.band_observed` log-wrapping) are *not* re-tested through full
 * runtime mocks here — they are single-line logger.info calls inside
 * already-tested branches, and the integration suite (`compact-service.int.test.ts`,
 * `runner.test.ts`) exercises those paths. The decision logic that *picks*
 * those branches (band observer, rate-limit gate) is covered by the pure-unit
 * layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── 1. Pure unit: createBandObserver ─────────────────────────────

import { createBandObserver } from "../../../vex-agent/engine/core/context-band.js";

describe("createBandObserver (PR3-telemetry pure unit)", () => {
  it("first observation in normal band does NOT emit", () => {
    const observe = createBandObserver(100_000);
    const r = observe(10_000);
    expect(r.band).toBe("normal");
    expect(r.emit).toBe(false);
    expect(r.fromBand).toBeNull();
  });

  it("first observation in elevated band emits with fromBand=null (initial-elevated)", () => {
    const observe = createBandObserver(100_000);
    const r = observe(90_000); // 0.90 → barrier
    expect(r.band).toBe("barrier");
    expect(r.emit).toBe(true);
    expect(r.fromBand).toBeNull();
  });

  it("upward transition emits with fromBand=previous", () => {
    const observe = createBandObserver(100_000);
    expect(observe(50_000).emit).toBe(false); // normal → no emit
    const up = observe(90_000); // → barrier
    expect(up.emit).toBe(true);
    expect(up.fromBand).toBe("normal");
    expect(up.band).toBe("barrier");
  });

  it("downward transition does NOT emit but still rotates previousBand", () => {
    const observe = createBandObserver(100_000);
    expect(observe(90_000).emit).toBe(true); // initial-elevated → barrier
    const down = observe(50_000); // back to normal
    expect(down.emit).toBe(false);
    expect(down.fromBand).toBe("barrier");
    expect(down.band).toBe("normal");

    // The state-rotation invariant: a NEW upward must now compare against
    // `normal`, not the stale `barrier`. Without that rotation, the next
    // upward would compare barrier→barrier and silently miss.
    const upAgain = observe(90_000);
    expect(upAgain.emit).toBe(true);
    expect(upAgain.fromBand).toBe("normal");
  });

  it("same-band observation does NOT emit", () => {
    const observe = createBandObserver(100_000);
    observe(50_000); // normal
    const same = observe(60_000); // still normal
    expect(same.emit).toBe(false);
    expect(same.band).toBe("normal");
  });

  it("warning → barrier → critical climb emits each step", () => {
    const observe = createBandObserver(100_000);
    expect(observe(86_000).emit).toBe(true); // initial-elevated → warning
    expect(observe(89_000).emit).toBe(true); // warning → barrier
    expect(observe(93_000).emit).toBe(true); // barrier → critical
    expect(observe(95_000).emit).toBe(false); // critical → critical (same)
  });
});

// ── 2. Pure unit: shouldEmitHeartbeatFailure ─────────────────────

import {
  shouldEmitHeartbeatFailure,
  _resetHeartbeatRateLimitForTesting,
} from "../../../vex-agent/engine/compact-jobs/heartbeat-rate-limit.js";

describe("shouldEmitHeartbeatFailure (PR3-telemetry pure unit)", () => {
  beforeEach(() => {
    _resetHeartbeatRateLimitForTesting();
  });

  it("first call for a worker returns true", () => {
    expect(shouldEmitHeartbeatFailure("worker-1", 0)).toBe(true);
  });

  it("second call within 60s window returns false", () => {
    shouldEmitHeartbeatFailure("worker-1", 0);
    expect(shouldEmitHeartbeatFailure("worker-1", 30_000)).toBe(false);
    expect(shouldEmitHeartbeatFailure("worker-1", 59_999)).toBe(false);
  });

  it("call at or after 60s returns true again and resets window", () => {
    shouldEmitHeartbeatFailure("worker-1", 0);
    expect(shouldEmitHeartbeatFailure("worker-1", 60_000)).toBe(true);
    // next call resets so further sub-window emits are suppressed
    expect(shouldEmitHeartbeatFailure("worker-1", 90_000)).toBe(false);
  });

  it("different workerIds are tracked independently", () => {
    shouldEmitHeartbeatFailure("worker-1", 0);
    expect(shouldEmitHeartbeatFailure("worker-2", 0)).toBe(true);
    expect(shouldEmitHeartbeatFailure("worker-2", 30_000)).toBe(false);
  });
});

// ── 3. Handler-level events ──────────────────────────────────────
//
// One shared module-level mock graph; each handler block configures return
// values per test. `logger` is the only thing we spy on; everything else is
// stubbed because the assertion is "did we log the event with the right
// shape at the right code path".

vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  insertEntry: vi.fn().mockResolvedValue({
    entry: {
      id: 1,
      kind: "test_kind",
      title: "t",
      summary: "s",
      validUntil: null,
      pinned: false,
      status: "active",
    },
    inserted: true,
  }),
  findByContentHash: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/knowledge-lifecycle.js", () => ({
  supersedeEntry: vi.fn().mockResolvedValue({
    successor: { id: 2, kind: "test_kind", validUntil: null, pinned: false, status: "active" },
    predecessor: { id: 1, status: "superseded" },
  }),
  SupersedeError: class extends Error {
    readonly code: string;
    readonly predecessorId: number | null;
    readonly details: unknown;
    constructor(code: string, message: string, predecessorId: number | null = null, details: unknown = null) {
      super(message);
      this.code = code;
      this.predecessorId = predecessorId;
      this.details = details;
    }
  },
}));

vi.mock("@vex-agent/db/repos/maintenance-lease.js", () => ({
  withLeaseSharedLock: async <T>(_pool: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> =>
    fn({ query: () => ({ rows: [], rowCount: 0 }) }),
  MaintenanceActiveError: class extends Error {
    readonly code = "MAINTENANCE_ACTIVE" as const;
    readonly ownerId: string;
    constructor(ownerId: string) {
      super(`maintenance active — lease "${ownerId}"`);
      this.ownerId = ownerId;
    }
  },
}));

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({ connect: async () => ({ query: vi.fn(), release: vi.fn() }) }),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

const mockGetSessionMemoryStats = vi.fn();
const mockRecallTopK = vi.fn().mockResolvedValue([]);
const mockGetById = vi.fn();
const mockMarkOutstandingResolved = vi.fn();
const mockUpdateEmbedding = vi.fn().mockResolvedValue(true);

vi.mock("@vex-agent/db/repos/session-memories/index.js", () => ({
  getSessionMemoryStats: (...a: unknown[]) => mockGetSessionMemoryStats(...a),
  recallTopK: (...a: unknown[]) => mockRecallTopK(...a),
  getById: (...a: unknown[]) => mockGetById(...a),
  markOutstandingResolved: (...a: unknown[]) => mockMarkOutstandingResolved(...a),
  updateEmbedding: (...a: unknown[]) => mockUpdateEmbedding(...a),
}));

vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedDocument: vi.fn().mockResolvedValue({
    embedding: new Array(768).fill(0.1),
    providerModel: "ai/embeddinggemma:300M-Q8_0",
  }),
  embedQuery: vi.fn().mockResolvedValue({
    embedding: new Array(768).fill(0.1),
    providerModel: "ai/embeddinggemma:300M-Q8_0",
  }),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search | query: ${q}`,
}));

vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => ({
    baseUrl: "http://localhost:12434",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: 768,
    provider: "local",
  }),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const mockExecuteCompactNow = vi.fn();
vi.mock("@vex-agent/engine/compact-jobs/service.js", () => ({
  executeCompactNow: (...a: unknown[]) => mockExecuteCompactNow(...a),
}));

const { default: logger } = await import("@utils/logger.js");
const { handleMemoryRecall } = await import(
  "../../../vex-agent/tools/internal/memory/recall.js"
);
const { handleMarkOutstandingResolved } = await import(
  "../../../vex-agent/tools/internal/memory/mark-resolved.js"
);
const { handleKnowledgeWrite } = await import(
  "../../../vex-agent/tools/internal/knowledge/write.js"
);
const { handleKnowledgeSupersede } = await import(
  "../../../vex-agent/tools/internal/knowledge/supersede.js"
);
const { handleCompactNow } = await import(
  "../../../vex-agent/tools/internal/compact/now.js"
);

function makeContext(overrides: Record<string, unknown> = {}): never {
  return {
    sessionId: "session-test",
    sessionKind: "agent",
    sessionPermission: "trusted",
    missionId: null,
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map(),
    sourceSurface: "vex_agent",
    sourceSession: "session-test",
    contextUsageBand: "barrier",
    ...overrides,
  } as never;
}

describe("memory_recall.called + memory_recall.empty_store", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    mockGetSessionMemoryStats.mockReset();
    mockRecallTopK.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("fires memory_recall.called once with queryLen + k payload", async () => {
    mockGetSessionMemoryStats.mockResolvedValue({
      activeCount: 3,
      compactCount: 1,
      recentThemes: [],
    });
    await handleMemoryRecall({ query: "what about WIF?", k: 3 }, makeContext());
    expect(infoSpy).toHaveBeenCalledWith(
      "memory_recall.called",
      expect.objectContaining({
        sessionId: "session-test",
        queryLen: "what about WIF?".length,
        k: 3,
      }),
    );
  });

  it("fires memory_recall.empty_store on empty-store short-circuit", async () => {
    mockGetSessionMemoryStats.mockResolvedValue({
      activeCount: 0,
      compactCount: 0,
      recentThemes: [],
    });
    await handleMemoryRecall({ query: "anything", k: 5 }, makeContext());
    expect(infoSpy).toHaveBeenCalledWith(
      "memory_recall.empty_store",
      expect.objectContaining({ sessionId: "session-test" }),
    );
  });

  it("does NOT fire memory_recall.empty_store when activeCount > 0", async () => {
    mockGetSessionMemoryStats.mockResolvedValue({
      activeCount: 1,
      compactCount: 1,
      recentThemes: [],
    });
    await handleMemoryRecall({ query: "WIF", k: 1 }, makeContext());
    const calls = infoSpy.mock.calls.filter((c) => c[0] === "memory_recall.empty_store");
    expect(calls).toHaveLength(0);
  });
});

describe("mark_outstanding_resolved.called", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    mockGetById.mockReset();
    mockMarkOutstandingResolved.mockReset();
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("fires before DB validation with memoryId + sessionId payload", async () => {
    mockGetById.mockResolvedValue({ id: 7, sessionId: "session-test", theme: "x", bodyMd: "y" });
    mockMarkOutstandingResolved.mockResolvedValue({
      ok: true,
      memory: {
        theme: "x",
        bodyMd: "body",
        outstandingItems: [],
      },
    });
    await handleMarkOutstandingResolved(
      {
        memory_id: 7,
        outstanding_item_id: "550e8400-e29b-41d4-a716-446655440000",
        resolution_note: "done",
      },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "mark_outstanding_resolved.called",
      expect.objectContaining({ sessionId: "session-test", memoryId: 7 }),
    );
  });
});

describe("knowledge.write.with_source", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("fires with default 'observed' when source omitted", async () => {
    await handleKnowledgeWrite(
      { kind: "test_pattern", title: "T", summary: "S" },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "knowledge.write.with_source",
      expect.objectContaining({
        kind: "test_pattern",
        source: "observed",
        pinned: false,
      }),
    );
  });

  it("fires with explicit source value when provided", async () => {
    await handleKnowledgeWrite(
      { kind: "test_pattern", title: "T", summary: "S", source: "user_confirmed", pinned: true },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "knowledge.write.with_source",
      expect.objectContaining({
        kind: "test_pattern",
        source: "user_confirmed",
        pinned: true,
      }),
    );
  });
});

describe("knowledge.supersede.with_source", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("fires with previousId + source + kind", async () => {
    await handleKnowledgeSupersede(
      {
        previous_id: 42,
        kind: "test_pattern",
        title: "T",
        summary: "S",
        reason: "outdated",
        source: "inferred",
      },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "knowledge.supersede.with_source",
      expect.objectContaining({
        kind: "test_pattern",
        source: "inferred",
        previousId: 42,
      }),
    );
  });

  it("defaults source to 'observed' when omitted", async () => {
    await handleKnowledgeSupersede(
      {
        previous_id: 42,
        kind: "test_pattern",
        title: "T",
        summary: "S",
        reason: "outdated",
      },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "knowledge.supersede.with_source",
      expect.objectContaining({ source: "observed" }),
    );
  });
});

describe("compact.now.called + compact.now.noop rename", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);
    mockExecuteCompactNow.mockReset();
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("fires compact.now.called at handler entry with lengths + band", async () => {
    mockExecuteCompactNow.mockResolvedValue({
      kind: "committed",
      generation: 1,
      archivedMessages: 10,
      jobId: 5,
      planMode: "agent_tool",
      redactionCounts: { hard: 0, mask: 0 },
    });
    await handleCompactNow(
      {
        conversation_summary: "summary text here that fits constraints",
        preserve_md: "preserve",
        thread_themes_hints: ["theme_one", "theme_two"],
      },
      makeContext({ contextUsageBand: "barrier" }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "compact.now.called",
      expect.objectContaining({
        sessionId: "session-test",
        summaryLen: "summary text here that fits constraints".length,
        preserveLen: "preserve".length,
        themeCount: 2,
        band: "barrier",
      }),
    );
  });

  it("fires renamed compact.now.noop on noop result (not old compact_now.noop)", async () => {
    mockExecuteCompactNow.mockResolvedValue({ kind: "noop", reason: "empty_prefix" });
    await handleCompactNow(
      { conversation_summary: "summary" },
      makeContext(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "compact.now.noop",
      expect.objectContaining({ sessionId: "session-test", reason: "empty_prefix" }),
    );
    const oldNameCalls = infoSpy.mock.calls.filter((c) => c[0] === "compact_now.noop");
    expect(oldNameCalls).toHaveLength(0);
  });
});

// ── 4. Naming-consistency lint ────────────────────────────────────

const EXCLUDED_DIR_NAMES = new Set(["__tests__", "scripts", "e2e", "node_modules"]);

/**
 * Pure-Node recursive walker over `src/vex-agent`. Avoids shelling out to
 * `git ls-files` (fails under restricted sandboxes with EPERM) and scans
 * untracked local files too — important for catching event-name regressions
 * before the offending file is staged.
 */
function listRuntimeFiles(): string[] {
  const root = resolve(process.cwd(), "src/vex-agent");
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Event names that historically existed under an underscore namespace and
 * MUST NOT regress. `compact_now.noop` was renamed to `compact.now.noop`
 * in PR3-telemetry; the dot form is canonical. `compact_worker.*` was a
 * stale handoff-doc name that never landed — the real surface is
 * `compact-worker.*`. `knowledge_write.with_source` was rejected during
 * codex review in favour of `knowledge.write.with_source`.
 */
const BANNED_EVENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /"compact_now\./,
    reason: "renamed to compact.now.* (dot-separated, canonical with compact.committed / compact.noop / compact.forced_fallback.*)",
  },
  {
    pattern: /"compact_worker\./,
    reason: "executor surface uses HYPHEN: compact-worker.* (matches compact-worker.claim_lost, .completed, .chunk_redacted, etc.)",
  },
  {
    pattern: /"knowledge_write\./,
    reason: "knowledge surface uses DOT: knowledge.write.*",
  },
  {
    pattern: /"knowledge_supersede\./,
    reason: "knowledge surface uses DOT: knowledge.supersede.*",
  },
];

describe("PR3-telemetry naming-consistency lint", () => {
  it("no runtime source emits a banned underscore-namespaced event", () => {
    const files = listRuntimeFiles();
    expect(files.length, "fs walker returned no runtime files").toBeGreaterThan(0);

    const offenders: Array<{ path: string; line: number; pattern: string; reason: string; snippet: string }> = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      const lines = raw.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        for (const { pattern, reason } of BANNED_EVENT_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push({
              path: file,
              line: i + 1,
              pattern: pattern.source,
              reason,
              snippet: line.trim().slice(0, 140),
            });
          }
        }
      }
    }

    if (offenders.length > 0) {
      const detail = offenders
        .map((o) => `  ${o.path}:${o.line}  [${o.pattern}]  ${o.reason}\n    ${o.snippet}`)
        .join("\n");
      throw new Error(
        `PR3-telemetry naming-consistency violated: ${offenders.length} occurrence(s).\n${detail}`,
      );
    }

    expect(offenders).toEqual([]);
  });
});
