import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── 1. Pure unit: createBandObserver ─────────────────────────────

import { createBandObserver } from "../../../../vex-agent/engine/core/context-band.js";

import {
  shouldEmitHeartbeatFailure,
  _resetHeartbeatRateLimitForTesting,
} from "../../../../vex-agent/engine/compact-jobs/heartbeat-rate-limit.js";

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
  "../../../../vex-agent/tools/internal/memory/recall.js"
);
const { handleMarkOutstandingResolved } = await import(
  "../../../../vex-agent/tools/internal/memory/mark-resolved.js"
);
const { handleKnowledgeWrite } = await import(
  "../../../../vex-agent/tools/internal/knowledge/write.js"
);
const { handleKnowledgeSupersede } = await import(
  "../../../../vex-agent/tools/internal/knowledge/supersede.js"
);
const { handleCompactNow } = await import(
  "../../../../vex-agent/tools/internal/compact/now.js"
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
