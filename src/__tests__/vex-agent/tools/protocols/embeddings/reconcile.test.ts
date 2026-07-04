/**
 * Tests for `reconcileToolEmbeddings` (and the `reembedAllTools` delegate) —
 * src/vex-agent/tools/protocols/embeddings/reembed.ts.
 *
 * Coverage focus (T0.5):
 *   - generation probe: the provider is probed once; its REPORTED model + the
 *     dim it returns (not config.model) define the current generation;
 *   - new tool embedded; changed-hash tool re-embedded;
 *   - unchanged text under the SAME generation skipped;
 *   - unchanged text under model-only / provider-alias drift RE-EMBEDDED
 *     (Codex-required — the generation predicate, not just content_hash);
 *   - orphan purge runs AFTER the upsert loop and is keyed on the PROBED
 *     provider model, not config.model (Codex-required);
 *   - `deleted` is surfaced on the report;
 *   - config-missing throws cleanly (infra error, not a per-tool error);
 *   - single-flight is shared between reconcile and reembedAllTools.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";
import type { ToolEmbeddingRow } from "@vex-agent/db/repos/tool-embeddings.js";

const TEST_DIM = 768;

// Active manifest surface — mutated per test (the reembed module reads
// `PROTOCOL_TOOLS.filter(...)` at run time so mutating the array contents is
// enough).
const mockManifests: ProtocolToolManifest[] = [];

const mockEmbedTool = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();
const mockFindExistingByHash = vi.fn();
const mockUpsertToolEmbedding = vi.fn();
const mockDeleteOrphaned = vi.fn();

vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedTool: (...args: unknown[]) => mockEmbedTool(...args),
  FORMATTER_VERSION: "v1-test",
}));

vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: mockManifests,
}));

vi.mock("@vex-agent/tools/protocols/lifecycle.js", () => ({
  isReembeddableNamespace: () => true,
}));

vi.mock("@vex-agent/db/repos/tool-embeddings.js", () => ({
  findExistingByHash: (hash: string) => mockFindExistingByHash(hash),
  upsertToolEmbedding: (input: unknown) => mockUpsertToolEmbedding(input),
  deleteOrphanedToolEmbeddings: (ids: readonly string[], model: string, dim: number) =>
    mockDeleteOrphaned(ids, model, dim),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { reconcileToolEmbeddings, reembedAllTools } = await import(
  "@vex-agent/tools/protocols/embeddings/reembed.js"
);

function makeManifest(toolId: string, text = `text for ${toolId}`): ProtocolToolManifest {
  return {
    toolId,
    namespace: "dexscreener",
    description: text,
  } as unknown as ProtocolToolManifest;
}

function makeEmbedding(): number[] {
  return Array.from({ length: TEST_DIM }, () => 0.1);
}

function makeRow(overrides: Partial<ToolEmbeddingRow> & { toolId: string }): ToolEmbeddingRow {
  return {
    namespace: "dexscreener",
    contentHash: "hash",
    embeddingModel: "actual-model",
    embeddingDim: TEST_DIM,
    refreshedAt: new Date(),
    ...overrides,
  };
}

function setManifests(...ids: string[]): void {
  mockManifests.splice(0, mockManifests.length, ...ids.map((id) => makeManifest(id)));
}

beforeEach(() => {
  vi.clearAllMocks();
  setManifests("tool_a");
  // config REQUESTS "requested-model"; the provider REPORTS "actual-model"
  // (aliasing) — every generation predicate must use the reported name.
  mockLoadEmbeddingConfig.mockReturnValue({
    baseUrl: "http://127.0.0.1:27134/v1",
    model: "requested-model",
    dim: TEST_DIM,
    provider: "local",
  });
  mockEmbedTool.mockResolvedValue({
    embedding: makeEmbedding(),
    providerModel: "actual-model",
  });
  mockFindExistingByHash.mockResolvedValue(null);
  mockUpsertToolEmbedding.mockResolvedValue(undefined);
  mockDeleteOrphaned.mockResolvedValue(0);
});

describe("reconcileToolEmbeddings", () => {
  it("probes the provider once at the start with the schema-probe input", async () => {
    await reconcileToolEmbeddings();
    const [probeTool, probeText] = mockEmbedTool.mock.calls[0]!;
    expect(probeTool).toBe("__schema_probe__");
    expect(probeText).toBe("ignore");
  });

  it("embeds a new tool (no existing row) and stamps the provider-reported model", async () => {
    mockFindExistingByHash.mockResolvedValue(null);
    const report = await reconcileToolEmbeddings();
    expect(report.embedded).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);
    // report generation reflects the PROBED provider model + dim, not config.
    expect(report.embeddingModel).toBe("actual-model");
    expect(report.embeddingDim).toBe(TEST_DIM);
    expect(mockUpsertToolEmbedding).toHaveBeenCalledTimes(1);
    const [upsert] = mockUpsertToolEmbedding.mock.calls[0]!;
    expect(upsert.toolId).toBe("tool_a");
    expect(upsert.embeddingModel).toBe("actual-model");
    expect(upsert.embeddingDim).toBe(TEST_DIM);
  });

  it("re-embeds a tool whose content_hash changed (no matching stored row)", async () => {
    // A changed source text hashes to something with no stored row.
    mockFindExistingByHash.mockResolvedValue(null);
    const report = await reconcileToolEmbeddings();
    expect(report.embedded).toBe(1);
    expect(mockUpsertToolEmbedding).toHaveBeenCalledTimes(1);
  });

  it("skips a tool whose stored row is current for THIS generation", async () => {
    mockFindExistingByHash.mockResolvedValue(
      makeRow({ toolId: "tool_a", embeddingModel: "actual-model", embeddingDim: TEST_DIM }),
    );
    const report = await reconcileToolEmbeddings();
    expect(report.skipped).toBe(1);
    expect(report.embedded).toBe(0);
    // probe only — no per-tool embed, no upsert.
    expect(mockEmbedTool).toHaveBeenCalledTimes(1);
    expect(mockUpsertToolEmbedding).not.toHaveBeenCalled();
  });

  it("RE-EMBEDS unchanged text when the model drifted (provider-alias case)", async () => {
    // Same content_hash row exists, but stamped under an OLD model name — the
    // generation predicate must force a re-embed, not skip.
    mockFindExistingByHash.mockResolvedValue(
      makeRow({ toolId: "tool_a", embeddingModel: "old-model", embeddingDim: TEST_DIM }),
    );
    const report = await reconcileToolEmbeddings();
    expect(report.skipped).toBe(0);
    expect(report.embedded).toBe(1);
    expect(mockUpsertToolEmbedding).toHaveBeenCalledTimes(1);
    const [upsert] = mockUpsertToolEmbedding.mock.calls[0]!;
    expect(upsert.embeddingModel).toBe("actual-model");
  });

  it("RE-EMBEDS unchanged text when the dim drifted", async () => {
    mockFindExistingByHash.mockResolvedValue(
      makeRow({ toolId: "tool_a", embeddingModel: "actual-model", embeddingDim: 512 }),
    );
    const report = await reconcileToolEmbeddings();
    expect(report.embedded).toBe(1);
  });

  it("purges orphans keyed on the PROBED provider model, not config.model", async () => {
    setManifests("tool_a", "tool_b");
    mockDeleteOrphaned.mockResolvedValue(3);
    const report = await reconcileToolEmbeddings();
    expect(mockDeleteOrphaned).toHaveBeenCalledTimes(1);
    const [ids, model, dim] = mockDeleteOrphaned.mock.calls[0]!;
    expect(ids).toEqual(["tool_a", "tool_b"]);
    expect(model).toBe("actual-model"); // NOT "requested-model"
    expect(dim).toBe(TEST_DIM);
    expect(report.deleted).toBe(3);
  });

  it("runs the orphan purge AFTER the upsert loop completes", async () => {
    setManifests("tool_a", "tool_b");
    const order: string[] = [];
    mockUpsertToolEmbedding.mockImplementation(async () => {
      order.push("upsert");
    });
    mockDeleteOrphaned.mockImplementation(async () => {
      order.push("purge");
      return 0;
    });
    await reconcileToolEmbeddings();
    expect(order).toEqual(["upsert", "upsert", "purge"]);
  });

  it("counts a per-tool embed failure in errors and still purges (does not throw)", async () => {
    setManifests("tool_a", "tool_b");
    // Call 0 is the probe (ok). Call 1 = tool_a (ok). Call 2 = tool_b (fails).
    mockEmbedTool
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "actual-model" })
      .mockResolvedValueOnce({ embedding: makeEmbedding(), providerModel: "actual-model" })
      .mockRejectedValueOnce(new Error("sidecar boom"));
    const report = await reconcileToolEmbeddings();
    expect(report.embedded).toBe(1);
    expect(report.errors).toBe(1);
    expect(mockDeleteOrphaned).toHaveBeenCalledTimes(1);
  });

  it("throws cleanly when the embedding config is missing", async () => {
    mockLoadEmbeddingConfig.mockImplementation(() => {
      throw new Error("Embedding config validation failed");
    });
    await expect(reconcileToolEmbeddings()).rejects.toThrow(/config validation failed/);
    expect(mockEmbedTool).not.toHaveBeenCalled();
    expect(mockDeleteOrphaned).not.toHaveBeenCalled();
  });

  it("propagates a failed generation probe as a thrown infra error (not per-tool)", async () => {
    mockEmbedTool.mockReset();
    mockEmbedTool.mockRejectedValue(new Error("ECONNREFUSED 27134"));
    await expect(reconcileToolEmbeddings()).rejects.toThrow(/ECONNREFUSED/);
    // Probe failed before the upsert loop — nothing purged.
    expect(mockUpsertToolEmbedding).not.toHaveBeenCalled();
    expect(mockDeleteOrphaned).not.toHaveBeenCalled();
  });
});

describe("single-flight", () => {
  it("shares one run between reconcileToolEmbeddings and reembedAllTools", async () => {
    const p1 = reconcileToolEmbeddings();
    const p2 = reembedAllTools();
    expect(p2).toBe(p1); // same in-flight promise
    await Promise.all([p1, p2]);
    // config loaded once, provider probed once — a single shared run.
    expect(mockLoadEmbeddingConfig).toHaveBeenCalledTimes(1);
    const probeCalls = mockEmbedTool.mock.calls.filter((c) => c[0] === "__schema_probe__");
    expect(probeCalls).toHaveLength(1);
  });
});
