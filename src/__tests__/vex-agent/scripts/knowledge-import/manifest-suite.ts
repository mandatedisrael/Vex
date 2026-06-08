import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function manifestSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, makeManifestLine, makeRowLine, lines } = ctx;

  describe("manifest validation", () => {
    it("aborts when input is empty", async () => {
      await expect(importKnowledge(lines())).rejects.toThrow(/no manifest line found/);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("aborts when first line is not a manifest", async () => {
      await expect(
        importKnowledge(lines(makeRowLine())),
      ).rejects.toThrow(/expected manifest with __type="vex_knowledge_export"/);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("aborts on unsupported manifest version", async () => {
      await expect(
        importKnowledge(
          lines(
            JSON.stringify({ __type: "vex_knowledge_export", version: 99 }),
            makeRowLine(),
          ),
        ),
      ).rejects.toThrow(/unsupported manifest version 99/);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("accepts manifest version 1 (legacy backup without lifecycle fields)", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "vex_knowledge_export", version: 1 }),
          makeRowLine(),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.supersedesId).toBeNull();
      expect(arg.statusReason).toBeNull();
      expect(arg.changeSummary).toBeNull();
      expect(arg.whatFailed).toBeNull();
    });

    it("accepts manifest version 2", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "vex_knowledge_export", version: 2 }),
          makeRowLine(),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    });

    it("accepts manifest version 3 (current — source + memory-v2 influence)", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "vex_knowledge_export", version: 3 }),
          makeRowLine(),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
    });

    it("aborts on malformed JSON", async () => {
      await expect(
        importKnowledge(lines(makeManifestLine(), "not json")),
      ).rejects.toThrow(/line 2: invalid JSON/);
    });
  });
}
