/**
 * Tests for `assertToolEmbeddingsReady` —
 * src/vex-agent/tools/protocols/embeddings/health.ts.
 *
 * The preflight must count `tool_embeddings` rows by the CURRENT generation —
 * the provider-REPORTED model + the dim the provider actually returns — not by
 * raw `config.model`. Reconcile (`reembed.ts`) stamps rows with `providerModel`,
 * so a preflight that counted by `config.model` would report a false "empty"
 * whenever the provider aliases the requested model name. Coverage:
 *   - probes the provider once with the schema-probe input;
 *   - counts by the probed (providerModel, dim), NOT config.model/config.dim
 *     (the provider-alias case);
 *   - throws the actionable "empty" message on zero rows;
 *   - throws the actionable "stale" message when rows < expected active count;
 *   - passes silently when rows >= expected;
 *   - propagates config-missing and probe-failure as thrown infra errors
 *     (never a false "table empty").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

const TEST_DIM = 768;

// Active manifest surface — mutated per test. health.ts reads
// `PROTOCOL_TOOLS.filter(...)` at call time, so mutating the array is enough.
const mockManifests: ProtocolToolManifest[] = [];

const mockEmbedTool = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();
const mockCountByModelDim = vi.fn();

vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedTool: (...args: unknown[]) => mockEmbedTool(...args),
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
  countByModelDim: (model: string, dim: number) => mockCountByModelDim(model, dim),
}));

const { assertToolEmbeddingsReady } = await import(
  "@vex-agent/tools/protocols/embeddings/health.js"
);

function makeManifest(toolId: string): ProtocolToolManifest {
  return {
    toolId,
    namespace: "dexscreener",
    description: `text for ${toolId}`,
  } as unknown as ProtocolToolManifest;
}

function makeEmbedding(dim = TEST_DIM): number[] {
  return Array.from({ length: dim }, () => 0.1);
}

function setManifests(...ids: string[]): void {
  mockManifests.splice(0, mockManifests.length, ...ids.map((id) => makeManifest(id)));
}

beforeEach(() => {
  vi.clearAllMocks();
  setManifests("tool_a", "tool_b");
  // config REQUESTS "requested-model"; the provider REPORTS "actual-model"
  // (aliasing). The count predicate must use the reported name + returned dim.
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
  mockCountByModelDim.mockResolvedValue(2);
});

describe("assertToolEmbeddingsReady", () => {
  it("probes the provider once with the schema-probe input", async () => {
    await assertToolEmbeddingsReady();
    expect(mockEmbedTool).toHaveBeenCalledTimes(1);
    const [probeTool, probeText, cfg] = mockEmbedTool.mock.calls[0]!;
    expect(probeTool).toBe("__schema_probe__");
    expect(probeText).toBe("ignore");
    // config is passed through so the probe hits the same provider/model.
    expect(cfg).toMatchObject({ model: "requested-model" });
  });

  it("counts by the PROBED provider model + dim, not config.model", async () => {
    await assertToolEmbeddingsReady();
    expect(mockCountByModelDim).toHaveBeenCalledTimes(1);
    const [model, dim] = mockCountByModelDim.mock.calls[0]!;
    expect(model).toBe("actual-model"); // NOT "requested-model"
    expect(dim).toBe(TEST_DIM);
  });

  it("uses the dim the provider actually returns, not config.dim", async () => {
    // Provider returns a longer vector than config.dim advertises — the
    // preflight must count by the returned length so it agrees with reconcile.
    mockEmbedTool.mockResolvedValue({
      embedding: makeEmbedding(512),
      providerModel: "actual-model",
    });
    mockCountByModelDim.mockResolvedValue(2);
    await assertToolEmbeddingsReady();
    const [, dim] = mockCountByModelDim.mock.calls[0]!;
    expect(dim).toBe(512);
  });

  it("passes silently when rows >= expected active count", async () => {
    mockCountByModelDim.mockResolvedValue(2);
    await expect(assertToolEmbeddingsReady()).resolves.toBeUndefined();
  });

  it("throws an actionable 'empty' error on zero rows", async () => {
    mockCountByModelDim.mockResolvedValue(0);
    await expect(assertToolEmbeddingsReady()).rejects.toThrow(
      /tool_embeddings is empty for model "actual-model" dim 768.*pnpm tool-reembed/s,
    );
  });

  it("throws an actionable 'stale' error when rows < expected count", async () => {
    setManifests("tool_a", "tool_b", "tool_c");
    mockCountByModelDim.mockResolvedValue(2);
    await expect(assertToolEmbeddingsReady()).rejects.toThrow(
      /stale for model "actual-model" dim 768: found 2 rows but expected at least 3 \(1 tool missing\).*pnpm tool-reembed/s,
    );
  });

  it("propagates a missing-config error without probing or counting", async () => {
    mockLoadEmbeddingConfig.mockImplementation(() => {
      throw new Error("Embedding config validation failed");
    });
    await expect(assertToolEmbeddingsReady()).rejects.toThrow(/config validation failed/);
    expect(mockEmbedTool).not.toHaveBeenCalled();
    expect(mockCountByModelDim).not.toHaveBeenCalled();
  });

  it("propagates a probe failure as an infra error (not a false 'empty')", async () => {
    mockEmbedTool.mockRejectedValue(new Error("ECONNREFUSED 27134"));
    await expect(assertToolEmbeddingsReady()).rejects.toThrow(/ECONNREFUSED/);
    // Probe failed before the count — the table is never falsely reported empty.
    expect(mockCountByModelDim).not.toHaveBeenCalled();
  });
});
