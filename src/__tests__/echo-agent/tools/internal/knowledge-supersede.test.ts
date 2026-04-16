/**
 * Dedicated tests for `handleKnowledgeSupersede`.
 *
 * The repo layer (`supersedeEntry`) has its own test file covering the
 * transactional + rejection matrix. Here we verify the handler contract:
 *   - param validation (missing/invalid fields reject BEFORE config/embed/DB)
 *   - embedding fail-loud (no DB call if embed fails)
 *   - SupersedeError codes map to actionable tool-level failures
 *   - happy path passes through to repo and returns the lineage shape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 768;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

const mockSupersedeEntry = vi.fn();
const mockEmbedDocument = vi.fn();
const mockLoadEmbeddingConfig = vi.fn(() => ({
  baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  model: TEST_PROVIDER_MODEL,
  dim: TEST_DIM,
  provider: "local",
}));

vi.mock("@echo-agent/db/repos/knowledge-lifecycle.js", async () => {
  const actual = await vi.importActual<typeof import("@echo-agent/db/repos/knowledge-lifecycle.js")>(
    "@echo-agent/db/repos/knowledge-lifecycle.js",
  );
  return {
    ...actual,
    supersedeEntry: (...args: unknown[]) => mockSupersedeEntry(...args),
  };
});

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: vi.fn(),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

vi.mock("@echo-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

const { handleKnowledgeSupersede } = await import(
  "@echo-agent/tools/internal/knowledge.js"
);
const { SupersedeError } = await import("@echo-agent/db/repos/knowledge-lifecycle.js");

import { makeTestContext } from "../_test-context.js";

function makeEmbedding(): number[] {
  return Array.from({ length: TEST_DIM }, () => 0.1);
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    successor: {
      id: 42,
      kind: "risk_rule",
      title: "cap 5%",
      summary: "pos size ≤ 5%",
      contentMd: "pos size ≤ 5%",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "active",
      pinned: false,
      validFrom: "2026-04-06T12:00:00Z",
      validUntil: "2026-04-13T12:00:00Z",
      contentHash: "b".repeat(64),
      embeddingModel: TEST_PROVIDER_MODEL,
      embeddingDim: TEST_DIM,
      sourceSurface: "echo_agent",
      sourceSession: null,
      supersedesId: 7,
      statusReason: null,
      changeSummary: "tightened from 10% to 5%",
      whatFailed: "3/24 days hit >7%",
      createdAt: "2026-04-06T12:00:00Z",
      updatedAt: "2026-04-06T12:00:00Z",
      ...overrides,
    },
    predecessor: {
      id: 7,
      kind: "risk_rule",
      title: "cap 10%",
      summary: "pos size ≤ 10%",
      contentMd: "pos size ≤ 10%",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "superseded",
      pinned: false,
      validFrom: "2026-04-01T00:00:00Z",
      validUntil: null,
      contentHash: "a".repeat(64),
      embeddingModel: TEST_PROVIDER_MODEL,
      embeddingDim: TEST_DIM,
      sourceSurface: "echo_agent",
      sourceSession: null,
      supersedesId: null,
      statusReason: "drawdown Q1",
      changeSummary: null,
      whatFailed: null,
      createdAt: "2026-04-01T00:00:00Z",
      updatedAt: "2026-04-06T12:00:00Z",
    },
  };
}

const VALID_ARGS = {
  previous_id: 7,
  kind: "risk_rule",
  title: "cap 5%",
  summary: "pos size ≤ 5%",
  reason: "drawdown Q1",
  change_summary: "tightened from 10% to 5%",
  what_failed: "3/24 days hit >7%",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedDocument.mockResolvedValue({
    embedding: makeEmbedding(),
    providerModel: TEST_PROVIDER_MODEL,
  });
  mockSupersedeEntry.mockResolvedValue(successResult());
});

describe("handleKnowledgeSupersede — validation", () => {
  it("rejects missing previous_id without embedding or DB", async () => {
    const result = await handleKnowledgeSupersede(
      { kind: "risk_rule", title: "t", summary: "s", reason: "r" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required fields");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockSupersedeEntry).not.toHaveBeenCalled();
  });

  it("rejects missing reason", async () => {
    const { reason: _reason, ...rest } = VALID_ARGS;
    const result = await handleKnowledgeSupersede(rest, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required fields");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("rejects invalid kind without embedding", async () => {
    const result = await handleKnowledgeSupersede(
      { ...VALID_ARGS, kind: "camelCase" },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid kind");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("rejects previous_id = 0 / negative", async () => {
    const result = await handleKnowledgeSupersede(
      { ...VALID_ARGS, previous_id: 0 },
      makeTestContext(),
    );
    expect(result.success).toBe(false);
    expect(mockSupersedeEntry).not.toHaveBeenCalled();
  });
});

describe("handleKnowledgeSupersede — fail-loud", () => {
  it("embedding service down → fail-loud, no DB write", async () => {
    mockEmbedDocument.mockRejectedValueOnce(new Error("ECONNREFUSED 12434"));
    const result = await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
    expect(mockSupersedeEntry).not.toHaveBeenCalled();
  });

  it("embedding config broken → fail-loud before provider call", async () => {
    mockLoadEmbeddingConfig.mockImplementationOnce(() => {
      throw new Error("EMBEDDING_BASE_URL missing");
    });
    const result = await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding config invalid");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
    expect(mockSupersedeEntry).not.toHaveBeenCalled();
  });
});

describe("handleKnowledgeSupersede — repo rejections", () => {
  it.each([
    ["predecessor_not_found", "entry 7 not found"],
    ["predecessor_not_active", "entry 7 has status invalidated"],
    ["predecessor_already_superseded", "entry 7 was already superseded by 55"],
    ["identical_content", "content identical to 7"],
    ["content_hash_collision", "collides with existing row 99"],
  ] as const)("maps SupersedeError code=%s to actionable tool failure", async (code, msg) => {
    mockSupersedeEntry.mockRejectedValueOnce(new SupersedeError(code, 7, msg));
    const result = await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain(`(${code})`);
    expect(result.output).toContain(msg);
  });

  it("unexpected repo error → generic failure (not swallowed)", async () => {
    mockSupersedeEntry.mockRejectedValueOnce(new Error("pool exhausted"));
    const result = await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    expect(result.success).toBe(false);
    expect(result.output).toContain("knowledge_supersede failed");
    expect(result.output).toContain("pool exhausted");
  });
});

describe("handleKnowledgeSupersede — happy path", () => {
  it("passes full input + embedding to repo and returns lineage shape", async () => {
    const result = await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    expect(result.success).toBe(true);

    expect(mockSupersedeEntry).toHaveBeenCalledTimes(1);
    const arg = mockSupersedeEntry.mock.calls[0]![0];
    expect(arg.previousId).toBe(7);
    expect(arg.kind).toBe("risk_rule");
    expect(arg.reason).toBe("drawdown Q1");
    expect(arg.changeSummary).toBe("tightened from 10% to 5%");
    expect(arg.whatFailed).toBe("3/24 days hit >7%");
    expect(arg.embedding).toHaveLength(TEST_DIM);
    // embeddingModel = providerModel (provenance honesty — mirrors knowledge_write).
    expect(arg.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(arg.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const parsed = JSON.parse(result.output);
    expect(parsed.id).toBe(42);
    expect(parsed.supersedesId).toBe(7);
    expect(parsed.predecessorStatus).toBe("superseded");
    expect(parsed.embedded).toBe(true);
  });

  it("content_md defaults to summary when omitted", async () => {
    await handleKnowledgeSupersede(VALID_ARGS, makeTestContext());
    const arg = mockSupersedeEntry.mock.calls[0]![0];
    expect(arg.contentMd).toBe("pos size ≤ 5%");
  });

  it("explicit content_md is used as-is", async () => {
    await handleKnowledgeSupersede(
      { ...VALID_ARGS, content_md: "## full body\n\ndetails" },
      makeTestContext(),
    );
    const arg = mockSupersedeEntry.mock.calls[0]![0];
    expect(arg.contentMd).toBe("## full body\n\ndetails");
  });

  it("pinned=true makes validUntil null", async () => {
    await handleKnowledgeSupersede(
      { ...VALID_ARGS, pinned: true, ttl_hours: 24 },
      makeTestContext(),
    );
    const arg = mockSupersedeEntry.mock.calls[0]![0];
    expect(arg.pinned).toBe(true);
    expect(arg.validUntil).toBeNull();
  });

  it("change_summary / what_failed default to null when empty", async () => {
    const { change_summary: _cs, what_failed: _wf, ...rest } = VALID_ARGS;
    await handleKnowledgeSupersede(rest, makeTestContext());
    const arg = mockSupersedeEntry.mock.calls[0]![0];
    expect(arg.changeSummary).toBeNull();
    expect(arg.whatFailed).toBeNull();
  });
});
