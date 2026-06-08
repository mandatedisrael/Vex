import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

/**
 * FIX-2 import-side coverage: `source` (provenance classification) AND the
 * memory-v2 influence/bi-temporal fields must survive a v3 backup→insert, and
 * a legacy v1/v2 backup (fields absent) must fall through to insertEntry
 * defaults rather than being silently coerced.
 */
export function v2InfluenceSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, makeRowLine, lines } = ctx;

  const v3 = JSON.stringify({ __type: "vex_knowledge_export", version: 3 });

  describe("v3 source + memory-v2 influence roundtrip", () => {
    it("v3: preserves non-default source + all influence fields through insertEntry", async () => {
      await importKnowledge(
        lines(
          v3,
          makeRowLine({
            source: "inferred",
            maturity_state: "reinforced",
            activation_strength: 0.25,
            influence_scope: "retrieval_boost",
            decay_policy: "time",
            regime_tags: ["bull", "high_vol"],
            first_promoted_at: "2026-04-01T00:00:00Z",
            last_reinforced_at: "2026-04-05T00:00:00Z",
            next_review_at: "2026-05-01T00:00:00Z",
            outcome_version: 4,
          }),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.source).toBe("inferred");
      expect(arg.maturityState).toBe("reinforced");
      expect(arg.activationStrength).toBe(0.25);
      expect(arg.influenceScope).toBe("retrieval_boost");
      expect(arg.decayPolicy).toBe("time");
      expect(arg.regimeTags).toEqual(["bull", "high_vol"]);
      expect(arg.firstPromotedAt).toEqual(new Date("2026-04-01T00:00:00Z"));
      expect(arg.lastReinforcedAt).toEqual(new Date("2026-04-05T00:00:00Z"));
      expect(arg.nextReviewAt).toEqual(new Date("2026-05-01T00:00:00Z"));
      expect(arg.outcomeVersion).toBe(4);
    });

    it("v3: source='inferred' survives import unchanged (the core FIX-2 catch)", async () => {
      await importKnowledge(lines(v3, makeRowLine({ source: "inferred" })));
      const arg = mockInsertEntry.mock.calls[0]![0];
      // inferred must NOT be silently re-tiered to observed on restore.
      expect(arg.source).toBe("inferred");
    });

    it("v3: absent source + influence fields fall through to insertEntry defaults (undefined)", async () => {
      // A v3 manifest whose rows omit the new fields (or a legacy v1/v2 backup)
      // must NOT carry explicit values — insertEntry applies the DB-equivalent
      // defaults (observed / established / 1.0 / advisory / none / [] / null / 0).
      await importKnowledge(lines(v3, makeRowLine()));
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.source).toBeUndefined();
      expect(arg.maturityState).toBeUndefined();
      expect(arg.activationStrength).toBeUndefined();
      expect(arg.influenceScope).toBeUndefined();
      expect(arg.decayPolicy).toBeUndefined();
      expect(arg.regimeTags).toBeUndefined();
      expect(arg.firstPromotedAt).toBeUndefined();
      expect(arg.lastReinforcedAt).toBeUndefined();
      expect(arg.nextReviewAt).toBeUndefined();
      expect(arg.outcomeVersion).toBeUndefined();
    });

    it("legacy: v1 manifest with no source/influence fields → all defaults (undefined)", async () => {
      await importKnowledge(
        lines(JSON.stringify({ __type: "vex_knowledge_export", version: 1 }), makeRowLine()),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.source).toBeUndefined();
      expect(arg.maturityState).toBeUndefined();
      expect(arg.influenceScope).toBeUndefined();
      expect(arg.outcomeVersion).toBeUndefined();
    });
  });

  describe("v3 validation rejects bad influence values (fail-loud, no insert)", () => {
    const bad: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["invalid source", { source: "rumor" }],
      ["invalid maturity_state", { maturity_state: "legendary" }],
      ["invalid influence_scope", { influence_scope: "execution_constraint" }],
      ["invalid decay_policy", { decay_policy: "exponential" }],
      ["activation_strength above 1", { activation_strength: 1.5 }],
      ["activation_strength below 0", { activation_strength: -0.1 }],
      ["non-numeric activation_strength", { activation_strength: "high" }],
      ["negative outcome_version", { outcome_version: -1 }],
      ["non-integer outcome_version", { outcome_version: 1.5 }],
      ["non-array regime_tags", { regime_tags: "bull" }],
    ];

    for (const [label, override] of bad) {
      it(`rejects ${label}`, async () => {
        const report = await importKnowledge(lines(v3, makeRowLine(override)));
        expect(report.failed).toBe(1);
        expect(report.inserted).toBe(0);
        expect(mockInsertEntry).not.toHaveBeenCalled();
      });
    }
  });
}
