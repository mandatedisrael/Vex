import { describe, it, expect, vi } from "vitest";
import type { SuiteCtx } from "./context.js";
import logger from "@utils/logger.js";

export function leaseSuite(ctx: SuiteCtx): void {
  const {
    importKnowledge,
    mockInsertEntry,
    mockWithLeaseSharedLock,
    MaintenanceActiveErrorMock,
    makeManifestLine,
    makeRowLine,
    lines,
  } = ctx;

  describe("maintenance lease", () => {
    it("lease active → row counted as failed; insertEntry not called", async () => {
      mockWithLeaseSharedLock.mockRejectedValueOnce(
        new MaintenanceActiveErrorMock("reembed:pid-42"),
      );

      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => logger);

      const report = await importKnowledge(lines(makeManifestLine(), makeRowLine()));

      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(0);
      expect(report.skipped_duplicate).toBe(0);
      expect(mockInsertEntry).not.toHaveBeenCalled();

      const maintenanceLog = errorSpy.mock.calls.find(
        ([event]) => event === "knowledge_import.row_maintenance_blocked",
      );
      expect(maintenanceLog).toBeDefined();
      expect(maintenanceLog?.[1]).toMatchObject({
        lineNumber: 2,
        ownerId: "reembed:pid-42",
      });
      const genericFailureLog = errorSpy.mock.calls.find(
        ([event]) => event === "knowledge_import.row_failed",
      );
      expect(genericFailureLog).toBeUndefined();

      errorSpy.mockRestore();
    });

    it("importer continues after a lease-blocked row", async () => {
      mockWithLeaseSharedLock.mockRejectedValueOnce(
        new MaintenanceActiveErrorMock("reembed:pid-99"),
      );
      // Second row (lease released): pass-through to insertEntry.
      mockWithLeaseSharedLock.mockImplementationOnce(
        async (_pool: unknown, fn: (tx: unknown) => Promise<unknown>) =>
          fn({ query: vi.fn() }),
      );

      const report = await importKnowledge(
        lines(
          makeManifestLine(),
          makeRowLine({ title: "blocked" }),
          makeRowLine({ title: "ok" }),
        ),
      );

      expect(report.total).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(1);
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    });

    it("happy path: insertEntry receives the tx from withLeaseSharedLock", async () => {
      await importKnowledge(lines(makeManifestLine(), makeRowLine()));

      expect(mockWithLeaseSharedLock).toHaveBeenCalledTimes(1);
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const [, txArg] = mockInsertEntry.mock.calls[0]!;
      expect(txArg).toBeDefined();
      expect(typeof (txArg as { query: unknown }).query).toBe("function");
    });
  });
}
