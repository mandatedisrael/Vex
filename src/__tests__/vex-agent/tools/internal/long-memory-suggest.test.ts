/**
 * Unit tests for the long_memory_suggest handler — the agent's only write-door
 * into long-term memory (S2). The DB repos, the embeddings client, and the
 * knowledge content-hash lookup are mocked, so these tests exercise only the
 * handler's redaction boundary, loop-prevention, derivation, and atomic
 * insert+enqueue control flow — never a real database or embeddings service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 8;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

// ── Mocks ─────────────────────────────────────────────────────────

const mockFindByContentHash = vi.fn();
vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  findByContentHash: (...args: unknown[]) => mockFindByContentHash(...args),
}));

const mockInsertCandidate = vi.fn();
const mockFindLatestCandidate = vi.fn();
vi.mock("@vex-agent/db/repos/memory-candidates/index.js", () => ({
  insertCandidate: (...args: unknown[]) => mockInsertCandidate(...args),
  findLatestCandidateByContentHash: (...args: unknown[]) => mockFindLatestCandidate(...args),
}));

const mockEnqueueConsolidateJob = vi.fn();
vi.mock("@vex-agent/db/repos/memory-jobs/index.js", () => ({
  enqueueConsolidateJob: (...args: unknown[]) => mockEnqueueConsolidateJob(...args),
}));

// withTransaction runs the callback with a sentinel tx client — no real pool.
const TX_SENTINEL = { __tx: true } as const;
const mockWithTransaction = vi.fn(
  async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(TX_SENTINEL),
);
vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => mockWithTransaction(fn),
}));

const mockEmbedDocument = vi.fn();
vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
}));

const mockLoadEmbeddingConfig = vi.fn(() => ({
  baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  model: TEST_PROVIDER_MODEL,
  dim: TEST_DIM,
  provider: "local",
}));
vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
}));

// memLog is a structural primitive; stub it so a missing transport never throws
// and so we can assert the reject-path emits a log without coupling to keys.
const mockMemLog = vi.fn();
vi.mock("@vex-agent/memory/observability/logger.js", () => ({
  memLog: Object.assign((...args: unknown[]) => mockMemLog(...args), {
    warn: (...args: unknown[]) => mockMemLog(...args),
    error: (...args: unknown[]) => mockMemLog(...args),
  }),
}));

import { handleLongMemorySuggest } from "@vex-agent/tools/internal/long-memory/suggest.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

// ── Helpers ───────────────────────────────────────────────────────

function ctx(): InternalToolContext {
  return { sessionId: "session-1" } as unknown as InternalToolContext;
}

function vector(): number[] {
  return Array.from({ length: TEST_DIM }, (_, i) => i / TEST_DIM);
}

function freshCandidate(overrides: Record<string, unknown> = {}) {
  return {
    candidate: { id: "11111111-1111-1111-1111-111111111111", status: "pending", ...overrides },
    inserted: true,
  };
}

function validArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "trade_lesson",
    title: "Back off on repeated 429s",
    summary: "When a protocol rate-limits bursts, wait and retry with backoff rather than hammering it.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path doubles.
  mockFindByContentHash.mockResolvedValue(null);
  mockFindLatestCandidate.mockResolvedValue(null);
  mockEmbedDocument.mockResolvedValue({ embedding: vector(), providerModel: TEST_PROVIDER_MODEL });
  mockInsertCandidate.mockResolvedValue(freshCandidate());
  mockEnqueueConsolidateJob.mockResolvedValue({ id: 1, jobKind: "consolidate" });
});

// ── Tests ─────────────────────────────────────────────────────────

describe("long_memory_suggest — accepted path", () => {
  it("stages a candidate and enqueues a consolidate job for a clean lesson", async () => {
    const res = await handleLongMemorySuggest(validArgs(), ctx());

    expect(res.success).toBe(true);
    expect(mockInsertCandidate).toHaveBeenCalledTimes(1);
    expect(mockEnqueueConsolidateJob).toHaveBeenCalledTimes(1);

    const data = JSON.parse(res.output);
    expect(data.candidateId).toBe("11111111-1111-1111-1111-111111111111");
    expect(data.status).toBe("pending");
    expect(data.duplicate).toBe(false);
  });

  it("stamps the hypothesis source floor, normal sensitivity, and the parent proposer", async () => {
    await handleLongMemorySuggest(validArgs(), ctx());

    const [insertInput] = mockInsertCandidate.mock.calls[0];
    expect(insertInput.source).toBe("hypothesis");
    expect(insertInput.sensitivity).toBe("normal");
    expect(insertInput.evidenceStrength).toBe("none");
    expect(insertInput.retrievalVisibility).toBe("not_consolidated");
    expect(insertInput.retainUntil).toBeNull();
    expect(insertInput.proposedBy).toBe("parent");
    expect(insertInput.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(insertInput.embeddingDim).toBe(TEST_DIM);
  });

  it("embeds after redaction, passing the redacted title and summary", async () => {
    await handleLongMemorySuggest(
      validArgs({ summary: "Send funds to 0x1234567890123456789012345678901234567890 carefully." }),
      ctx(),
    );
    const [title, summary] = mockEmbedDocument.mock.calls[0];
    expect(title).toBe("Back off on repeated 429s");
    // The address is masked before it reaches the embedder.
    expect(summary).not.toContain("0x1234567890123456789012345678901234567890");
    expect(summary).toContain("…");
  });

  it("runs the insert and the enqueue inside one transaction", async () => {
    await handleLongMemorySuggest(validArgs(), ctx());
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    // Both writes received the SAME tx sentinel — proving one atomic unit.
    const insertTx = mockInsertCandidate.mock.calls[0][1];
    const enqueueTx = mockEnqueueConsolidateJob.mock.calls[0][0];
    expect(insertTx).toBe(enqueueTx);
  });
});

describe("long_memory_suggest — secret rejection", () => {
  it("rejects a hard secret in the summary with a steering message and writes nothing", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({ summary: "The api key is sk-or-abcdefghijklmnopqrstuvwxyz0123456789 keep it." }),
      ctx(),
    );

    expect(res.success).toBe(false);
    expect(res.output).toMatch(/secret/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("rejects a secret hidden inside an entity token", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({ entities: ["SOL", "private_key: 0x" + "a".repeat(64)] }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/secret/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });

  it("rejects a secret hidden inside a toolCallId pointer string", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({ source_refs: { toolCallIds: ["sk-or-abcdefghijklmnopqrstuvwxyz0123456789"] } }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/secret/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });

  it("rejects a secret hidden inside an evidence instrumentKey", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({
        evidence_refs: [
          { executionId: 5, instrumentKey: "private_key: 0x" + "b".repeat(64) },
        ],
      }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/secret/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });

  it("rejects a credential-shaped kind that is still valid snake_case", async () => {
    // `sk_live_…` passes the snake_case kind rule but is a secret token.
    const res = await handleLongMemorySuggest(
      validArgs({ kind: "sk_live_51abcdefghijklmnopqrstuvwxyz0123" }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/secret/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });
});

describe("long_memory_suggest — live-state rejection", () => {
  it("rejects a summary that reads mostly as live values", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({
        title: "now",
        summary: "balance is 1.2 SOL price $0.0042 gas 5 gwei slippage 5% slippage",
        content_md: "",
      }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/live state/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });

  it("rejects live state smuggled into entities and tags, not just the main text", async () => {
    // Clean title/summary, but the persisted entities/tags are packed with live
    // values — they must count toward the live-state gate.
    const res = await handleLongMemorySuggest(
      validArgs({
        title: "x",
        summary: "y",
        content_md: "",
        entities: ["balance is 1.2 SOL", "balance is 5000 USDC", "price $0.0042"],
        tags: ["gas 5 gwei", "block 18293821", "slippage 5% slippage"],
      }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/live state/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });
});

describe("long_memory_suggest — non-English rejection (§10.4)", () => {
  it("rejects a Polish lesson with English steering text BEFORE any lookup/embed/insert", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({
        title: "Preferencja slippage uzytkownika",
        summary:
          "User zadeklarował preferencję dla swapów z niskim slippage, tolerując maksymalnie pół procenta na wszystkich trasach DEX.",
      }),
      ctx(),
    );

    expect(res.success).toBe(false);
    expect(res.output).toMatch(/english/i);
    // Ordering: the English reject fires before loop-prevention, embedding,
    // and the atomic insert+enqueue — nothing downstream may run.
    expect(mockFindByContentHash).not.toHaveBeenCalled();
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });

  it("rejects a non-English entity descriptor while the prose is English", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({ entities: ["SOL", "preferencja użytkownika"] }),
      ctx(),
    );
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/english/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });
});

describe("long_memory_suggest — masked address sensitivity", () => {
  it("stores a wallet address masked and marks the candidate sensitive", async () => {
    await handleLongMemorySuggest(
      validArgs({
        summary: "Treasury wallet 0x1234567890123456789012345678901234567890 funds risk strategy.",
      }),
      ctx(),
    );
    const [insertInput] = mockInsertCandidate.mock.calls[0];
    expect(insertInput.sensitivity).toBe("sensitive");
    // The raw address never reaches storage.
    expect(insertInput.summary).not.toContain("0x1234567890123456789012345678901234567890");
  });
});

describe("long_memory_suggest — embedding outage", () => {
  it("fails loud and writes nothing when the embedder is unavailable", async () => {
    mockEmbedDocument.mockRejectedValue(new Error("connection refused"));
    const res = await handleLongMemorySuggest(validArgs(), ctx());

    expect(res.success).toBe(false);
    expect(res.output).toMatch(/embedding service unavailable/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });
});

describe("long_memory_suggest — loop prevention", () => {
  it("returns already_known without inserting when the content is already promoted to knowledge", async () => {
    mockFindByContentHash.mockResolvedValue({ id: 99, kind: "trade_lesson" });
    const res = await handleLongMemorySuggest(validArgs(), ctx());

    expect(res.success).toBe(true);
    const data = JSON.parse(res.output);
    expect(data.status).toBe("already_known");
    expect(data.duplicate).toBe(true);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });

  it("returns a duplicate without inserting when a terminal candidate already exists for the hash", async () => {
    mockFindLatestCandidate.mockResolvedValue({
      id: "22222222-2222-2222-2222-222222222222",
      status: "rejected",
    });
    const res = await handleLongMemorySuggest(validArgs(), ctx());

    expect(res.success).toBe(true);
    const data = JSON.parse(res.output);
    expect(data.candidateId).toBe("22222222-2222-2222-2222-222222222222");
    expect(data.status).toBe("rejected");
    expect(data.duplicate).toBe(true);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
    expect(mockEnqueueConsolidateJob).not.toHaveBeenCalled();
  });

  it("still inserts and enqueues when only a pending candidate exists for the hash", async () => {
    mockFindLatestCandidate.mockResolvedValue({
      id: "33333333-3333-3333-3333-333333333333",
      status: "pending",
    });
    // The pending upsert conflicts → inserted:false, but the wake must still run.
    mockInsertCandidate.mockResolvedValue(
      freshCandidate({ id: "33333333-3333-3333-3333-333333333333" }),
    );
    mockInsertCandidate.mockResolvedValueOnce({
      candidate: { id: "33333333-3333-3333-3333-333333333333", status: "pending" },
      inserted: false,
    });

    const res = await handleLongMemorySuggest(validArgs(), ctx());

    expect(res.success).toBe(true);
    const data = JSON.parse(res.output);
    expect(data.duplicate).toBe(true);
    expect(mockInsertCandidate).toHaveBeenCalledTimes(1);
    // Enqueue runs even on inserted:false so a stranded pending row gets a wake.
    expect(mockEnqueueConsolidateJob).toHaveBeenCalledTimes(1);
  });
});

describe("long_memory_suggest — response format", () => {
  it("returns the concise shape by default", async () => {
    const res = await handleLongMemorySuggest(validArgs(), ctx());
    const data = JSON.parse(res.output);
    expect(Object.keys(data).sort()).toEqual(["candidateId", "duplicate", "status"]);
  });

  it("returns the detailed shape with redaction counts and the dual-trace window", async () => {
    const res = await handleLongMemorySuggest(
      validArgs({
        summary: "Treasury wallet 0x1234567890123456789012345678901234567890 risk strategy lesson.",
        response_format: "detailed",
      }),
      ctx(),
    );
    const data = JSON.parse(res.output);
    expect(data.source).toBe("hypothesis");
    expect(data.sensitivity).toBe("sensitive");
    expect(typeof data.retrievalUntil).toBe("string");
    expect(data.redactions).toEqual({ hard: 0, masked: 1 });
  });
});

describe("long_memory_suggest — input validation", () => {
  it("fails with a steering message when a required field is missing", async () => {
    const res = await handleLongMemorySuggest({ kind: "trade_lesson", title: "x" }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/summary/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });

  it("fails with a steering message when kind is not snake_case", async () => {
    const res = await handleLongMemorySuggest(validArgs({ kind: "Trade Lesson" }), ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/kind/i);
    expect(mockInsertCandidate).not.toHaveBeenCalled();
  });
});
