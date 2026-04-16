import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function updateStatusSuite(ctx: SuiteCtx): void {
  const { handleKnowledgeUpdateStatus, makeTestContext, mockUpdateStatus } = ctx;

  describe("handleKnowledgeUpdateStatus", () => {
    it("fails on missing params", async () => {
      const result = await handleKnowledgeUpdateStatus({}, makeTestContext());
      expect(result.success).toBe(false);
      expect(result.output).toContain("Missing required parameters");
    });

    it("rejects active (cannot transition back)", async () => {
      const result = await handleKnowledgeUpdateStatus(
        { id: 1, status: "active" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid status");
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it("rejects superseded (collapsed in MVP — fix 4)", async () => {
      const result = await handleKnowledgeUpdateStatus(
        { id: 1, status: "superseded" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid status");
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it("rejects garbage status", async () => {
      const result = await handleKnowledgeUpdateStatus(
        { id: 1, status: "deleted" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid status");
      expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it("invalidated is accepted and reason is persisted via repo", async () => {
      const result = await handleKnowledgeUpdateStatus(
        { id: 5, status: "invalidated", reason: "no longer holds" },
        makeTestContext(),
      );
      expect(result.success).toBe(true);
      // Reason is now forwarded to the repo so it lands in status_reason.
      expect(mockUpdateStatus).toHaveBeenCalledWith(5, "invalidated", "no longer holds");
      const parsed = JSON.parse(result.output);
      expect(parsed.reason).toBe("no longer holds");
    });

    it("archived without reason forwards undefined (repo preserves existing status_reason)", async () => {
      const result = await handleKnowledgeUpdateStatus(
        { id: 5, status: "archived" },
        makeTestContext(),
      );
      expect(result.success).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith(5, "archived", undefined);
      const parsed = JSON.parse(result.output);
      expect(parsed.reason).toBeNull();
    });

    it("returns failure when entry not found in DB", async () => {
      mockUpdateStatus.mockResolvedValueOnce({ ok: false, reason: "not_found" });
      const result = await handleKnowledgeUpdateStatus(
        { id: 999, status: "archived" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("not found");
    });

    it("returns actionable failure when entry is not active (superseded)", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        reason: "not_active",
        currentStatus: "superseded",
      });
      const result = await handleKnowledgeUpdateStatus(
        { id: 1, status: "archived", reason: "cleanup" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("not active");
      expect(result.output).toContain("superseded");
      expect(result.output).toContain("archived");
    });

    it("returns actionable failure when entry is already invalidated", async () => {
      mockUpdateStatus.mockResolvedValueOnce({
        ok: false,
        reason: "not_active",
        currentStatus: "invalidated",
      });
      const result = await handleKnowledgeUpdateStatus(
        { id: 2, status: "archived" },
        makeTestContext(),
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("invalidated");
    });
  });
}
