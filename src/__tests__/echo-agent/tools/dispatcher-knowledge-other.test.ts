import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import {
  mockEmbedDocument,
  mockKnowledgeInsert,
  mockKnowledgeGetById,
  mockKnowledgeUpdateStatus,
  mockKnowledgeSupersede,
} from "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — knowledge_write / get / update_status", () => {
  it("rejects memory_manage as an unknown tool (replaced by knowledge_*)", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "list" }, toolCallId: "call_11" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown");
  });

  it("routes knowledge_write to handler with embedding + insert", async () => {
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: {
          kind: "memo",
          title: "test title",
          summary: "test summary",
        },
        toolCallId: "call_kw_1",
      },
      baseContext,
    );
    expect(result.success).toBe(true);
    // embedDocument is now called with config (configOverride argument)
    expect(mockEmbedDocument).toHaveBeenCalledTimes(1);
    const [embedTitle, embedSummary] = mockEmbedDocument.mock.calls[0];
    expect(embedTitle).toBe("test title");
    expect(embedSummary).toBe("test summary");
    expect(mockKnowledgeInsert).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toBe(42);
    expect(parsed.embedded).toBe(true);
    expect(parsed.duplicate).toBe(false);
  });

  it("knowledge_write fails loud when embedding service throws", async () => {
    mockKnowledgeInsert.mockClear();
    mockEmbedDocument.mockRejectedValueOnce(new Error("ECONNREFUSED 12434"));
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: { kind: "memo", title: "t", summary: "s" },
        toolCallId: "call_kw_2",
      },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
    // No DB write attempted
    expect(mockKnowledgeInsert).not.toHaveBeenCalled();
  });

  it("knowledge_write rejects invalid kind", async () => {
    mockEmbedDocument.mockClear();
    const result = await dispatchTool(
      {
        name: "knowledge_write",
        args: { kind: "camelCase", title: "t", summary: "s" },
        toolCallId: "call_kw_3",
      },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid kind");
    expect(mockEmbedDocument).not.toHaveBeenCalled();
  });

  it("knowledge_get loads content_md into context.loadedDocuments", async () => {
    mockKnowledgeGetById.mockResolvedValueOnce({
      id: 7,
      kind: "memo",
      title: "t",
      summary: "s",
      contentMd: "full markdown body",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "active" as const,
      pinned: true,
      validFrom: "2026-04-06T12:00:00Z",
      validUntil: null,
      contentHash: "a".repeat(64),
      embeddingModel: "ai/embeddinggemma:300M-Q8_0",
      embeddingDim: 768,
      createdAt: "2026-04-06T12:00:00Z",
      updatedAt: "2026-04-06T12:00:00Z",
    });
    const ctx = makeTestContext();
    const result = await dispatchTool(
      { name: "knowledge_get", args: { id: 7 }, toolCallId: "call_kg_1" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(ctx.loadedDocuments.get("knowledge:7")).toBe("full markdown body");
  });

  it("knowledge_get fails on missing id", async () => {
    mockKnowledgeGetById.mockResolvedValueOnce(null);
    const result = await dispatchTool(
      { name: "knowledge_get", args: { id: 999 }, toolCallId: "call_kg_2" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  it("knowledge_update_status validates enum (rejects active)", async () => {
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "active" }, toolCallId: "call_ks_1" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockKnowledgeUpdateStatus).not.toHaveBeenCalled();
  });

  it("knowledge_update_status rejects superseded (collapsed in MVP — fix 4)", async () => {
    mockKnowledgeUpdateStatus.mockClear();
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "superseded" }, toolCallId: "call_ks_1b" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid status");
    expect(mockKnowledgeUpdateStatus).not.toHaveBeenCalled();
  });

  it("knowledge_update_status applies valid status (no reason → undefined reason arg)", async () => {
    const result = await dispatchTool(
      { name: "knowledge_update_status", args: { id: 1, status: "invalidated" }, toolCallId: "call_ks_2" },
      baseContext,
    );
    expect(result.success).toBe(true);
    // Handler forwards reason (undefined when omitted) to repo so status_reason stays untouched.
    expect(mockKnowledgeUpdateStatus).toHaveBeenCalledWith(1, "invalidated", undefined);
  });

  it("knowledge_update_status with reason forwards it to repo", async () => {
    mockKnowledgeUpdateStatus.mockClear();
    const result = await dispatchTool(
      {
        name: "knowledge_update_status",
        args: { id: 1, status: "archived", reason: "not relevant anymore" },
        toolCallId: "call_ks_2r",
      },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(mockKnowledgeUpdateStatus).toHaveBeenCalledWith(1, "archived", "not relevant anymore");
  });

  it("routes knowledge_supersede to handler with embed + supersedeEntry call", async () => {
    mockEmbedDocument.mockClear();
    mockKnowledgeSupersede.mockClear();
    const result = await dispatchTool(
      {
        name: "knowledge_supersede",
        args: {
          previous_id: 42,
          kind: "risk_rule",
          title: "cap 5%",
          summary: "pos size ≤ 5%",
          reason: "drawdown Q1",
          change_summary: "tightened from 10% to 5%",
        },
        toolCallId: "call_ksup_1",
      },
      baseContext,
    );
    expect(result.success).toBe(true);
    expect(mockEmbedDocument).toHaveBeenCalledTimes(1);
    expect(mockKnowledgeSupersede).toHaveBeenCalledTimes(1);
    const arg = mockKnowledgeSupersede.mock.calls[0]![0];
    expect(arg.previousId).toBe(42);
    expect(arg.reason).toBe("drawdown Q1");
    expect(arg.changeSummary).toBe("tightened from 10% to 5%");
    const parsed = JSON.parse(result.output);
    expect(parsed.supersedesId).toBe(42);
    expect(parsed.id).toBe(43);
  });
});
