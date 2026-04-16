import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function crudSuite(ctx: SuiteCtx): void {
  const {
    insertEntry,
    getById,
    findByContentHash,
    updateStatus,
    mockExecute,
    mockQueryOne,
    SAMPLE_HASH,
    SAMPLE_ROW,
    makeEmbedding,
    baseInsertInput,
  } = ctx;

  describe("insertEntry", () => {
    it("inserts via CTE upsert with vector cast and returns {entry, inserted: true}", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      const result = await insertEntry(baseInsertInput());

      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("WITH ins AS");
      expect(sql).toContain("INSERT INTO knowledge_entries");
      expect(sql).toContain("$15::vector");
      expect(sql).toContain("ON CONFLICT (content_hash) DO NOTHING");
      expect(sql).toContain("UNION ALL");
      // Vector serialized to literal as the 15th positional param
      expect(params[14]).toBe(`[${makeEmbedding(768).join(",")}]`);
      // content_hash is positional param 12 (0-indexed: 11)
      expect(params[11]).toBe(SAMPLE_HASH);
      // tags as array
      expect(params).toContainEqual(["solana"]);
      // JSONB stringified
      expect(params).toContainEqual(JSON.stringify({ protocol_executions: [1] }));

      expect(result.inserted).toBe(true);
      expect(result.entry.id).toBe(42);
      expect(result.entry.contentHash).toBe(SAMPLE_HASH);
      expect(result.entry.embeddingModel).toBe("ai/embeddinggemma:300M-Q8_0");
    });

    it("returns {inserted: false} when content_hash already exists (upsert no-op)", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: false });
      const result = await insertEntry(baseInsertInput());
      expect(result.inserted).toBe(false);
      expect(result.entry.id).toBe(42);
    });

    it("passes null valid_until when pinned", async () => {
      mockQueryOne.mockResolvedValueOnce({
        ...SAMPLE_ROW,
        pinned: true,
        valid_until: null,
        inserted: true,
      });
      await insertEntry({ ...baseInsertInput(), pinned: true, validUntil: null });
      const [, params] = mockQueryOne.mock.calls[0];
      // valid_until is the 11th positional param (0-indexed 10)
      expect(params[10]).toBeNull();
    });

    it("uses COALESCE defaults when audit fields are not provided", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      await insertEntry(baseInsertInput());
      const [, params] = mockQueryOne.mock.calls[0];
      // Param order after the source_surface/source_session add (R3 knowledge
      // provenance migration):
      //   7  status        → COALESCE → 'active'
      //   9  valid_from    → COALESCE → NOW()
      //   15 source_surface → COALESCE → 'echo_agent'
      //   16 source_session → NULL when not provided
      //   17 created_at    → COALESCE → NOW()
      //   18 updated_at    → COALESCE → NOW()
      expect(params[7]).toBeNull();
      expect(params[9]).toBeNull();
      expect(params[15]).toBeNull(); // sourceSurface defaults to undefined → null at param level
      expect(params[16]).toBeNull(); // sourceSession defaults to undefined → null
      expect(params[17]).toBeNull();
      expect(params[18]).toBeNull();
    });

    it("preserves audit fields when provided (import roundtrip)", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      const validFrom = new Date("2025-01-01T00:00:00Z");
      const createdAt = new Date("2025-01-01T00:00:00Z");
      const updatedAt = new Date("2025-06-01T00:00:00Z");
      await insertEntry({
        ...baseInsertInput(),
        status: "invalidated",
        validFrom,
        createdAt,
        updatedAt,
      });
      const [, params] = mockQueryOne.mock.calls[0];
      expect(params[7]).toBe("invalidated");
      expect(params[9]).toBe(validFrom.toISOString());
      // After lifecycle columns (supersedes_id/status_reason/change_summary/what_failed
      // at params 17..20), created_at moved 17 → 21, updated_at 18 → 22.
      expect(params[17]).toBeNull(); // supersedesId default
      expect(params[18]).toBeNull(); // statusReason default
      expect(params[19]).toBeNull(); // changeSummary default
      expect(params[20]).toBeNull(); // whatFailed default
      expect(params[21]).toBe(createdAt.toISOString());
      expect(params[22]).toBe(updatedAt.toISOString());
    });

    it("passes lifecycle fields (supersedesId + reason + change_summary + what_failed) when provided", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, inserted: true });
      await insertEntry({
        ...baseInsertInput(),
        supersedesId: 7,
        statusReason: "replaced by tighter rule",
        changeSummary: "threshold 10% → 5%",
        whatFailed: "3/24 days hit >7% drawdown",
      });
      const [, params] = mockQueryOne.mock.calls[0];
      expect(params[17]).toBe(7);
      expect(params[18]).toBe("replaced by tighter rule");
      expect(params[19]).toBe("threshold 10% → 5%");
      expect(params[20]).toBe("3/24 days hit >7% drawdown");
    });

    it("throws when embedding length does not match embeddingDim (pre-DB guard)", async () => {
      const input = baseInsertInput();
      input.embedding = makeEmbedding(512);
      input.embeddingDim = 768;
      await expect(insertEntry(input)).rejects.toThrow(
        /embedding length 512 does not match embeddingDim 768/,
      );
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  describe("getById", () => {
    it("returns mapped entry on hit with lineage LEFT JOIN", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, superseded_by: null });
      const result = await getById(42);
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("FROM knowledge_entries k");
      expect(sql).toContain("LEFT JOIN knowledge_entries succ ON succ.supersedes_id = k.id");
      expect(sql).toContain("WHERE k.id = $1");
      expect(params).toEqual([42]);
      expect(result?.id).toBe(42);
      expect(result?.contentHash).toBe(SAMPLE_HASH);
      expect(result?.supersededBy).toBeNull();
    });

    it("returns supersededBy id when a successor exists", async () => {
      mockQueryOne.mockResolvedValueOnce({ ...SAMPLE_ROW, superseded_by: 99 });
      const result = await getById(42);
      expect(result?.supersededBy).toBe(99);
    });

    it("returns null on miss", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await getById(99)).toBeNull();
    });

    it("returns null for invalid id without hitting DB", async () => {
      expect(await getById(0)).toBeNull();
      expect(await getById(-1)).toBeNull();
      expect(await getById(NaN)).toBeNull();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  describe("findByContentHash", () => {
    it("returns mapped entry on hash hit", async () => {
      mockQueryOne.mockResolvedValueOnce(SAMPLE_ROW);
      const result = await findByContentHash(SAMPLE_HASH);
      const [sql, params] = mockQueryOne.mock.calls[0];
      expect(sql).toContain("WHERE content_hash = $1");
      expect(params).toEqual([SAMPLE_HASH]);
      expect(result?.id).toBe(42);
    });

    it("returns null on miss", async () => {
      mockQueryOne.mockResolvedValueOnce(null);
      expect(await findByContentHash("deadbeef")).toBeNull();
    });

    it("returns null on empty hash without hitting DB", async () => {
      expect(await findByContentHash("")).toBeNull();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("issues UPDATE guarded by status='active' (no reason) and returns { ok: true } on match", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const result = await updateStatus(42, "invalidated");
      expect(result).toEqual({ ok: true });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("UPDATE knowledge_entries");
      expect(sql).toContain("SET status = $1");
      expect(sql).toContain("WHERE id = $2 AND status = 'active'");
      expect(sql).not.toContain("status_reason");
      expect(params).toEqual(["invalidated", 42]);
    });

    it("persists reason to status_reason when provided", async () => {
      mockExecute.mockResolvedValueOnce(1);
      const result = await updateStatus(42, "invalidated", "contradicted by Apr 12 data");
      expect(result).toEqual({ ok: true });
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status_reason = $2");
      expect(sql).toContain("WHERE id = $3 AND status = 'active'");
      expect(params).toEqual(["invalidated", "contradicted by Apr 12 data", 42]);
    });

    it("explicit null clears status_reason", async () => {
      mockExecute.mockResolvedValueOnce(1);
      await updateStatus(42, "archived", null);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("status_reason = $2");
      expect(params).toEqual(["archived", null, 42]);
    });

    it("zero-rows + no row exists → { ok: false, reason: not_found }", async () => {
      mockExecute.mockResolvedValueOnce(0);
      mockQueryOne.mockResolvedValueOnce(null);
      const result = await updateStatus(99, "archived");
      expect(result).toEqual({ ok: false, reason: "not_found" });
    });

    it("zero-rows + row exists with non-active status → { ok: false, reason: not_active, currentStatus }", async () => {
      mockExecute.mockResolvedValueOnce(0);
      mockQueryOne.mockResolvedValueOnce({ status: "superseded" });
      const result = await updateStatus(42, "archived", "historical cleanup");
      expect(result).toEqual({
        ok: false,
        reason: "not_active",
        currentStatus: "superseded",
      });
      // Follow-up SELECT was issued once to disambiguate
      expect(mockQueryOne).toHaveBeenCalledTimes(1);
      const [disambigSql, disambigParams] = mockQueryOne.mock.calls[0];
      expect(disambigSql).toContain("SELECT status FROM knowledge_entries WHERE id = $1");
      expect(disambigParams).toEqual([42]);
    });

    it("invalid id short-circuits to { ok: false, reason: not_found } without DB call", async () => {
      const result = await updateStatus(0, "archived");
      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(mockExecute).not.toHaveBeenCalled();
      expect(mockQueryOne).not.toHaveBeenCalled();
    });
  });
}
