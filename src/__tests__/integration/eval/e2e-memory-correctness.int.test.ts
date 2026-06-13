/**
 * Time-simulated memory eval — END-TO-END CORRECTNESS RUNNER (S4).
 *
 * Drives the `_world-corpus.ts` stream ONE ITEM AT A TIME through the REAL Vex
 * memory pipeline over SIMULATED time and CAPTURES the per-item + final state for
 * the S5 oracle scorer. S4 PROVES the run executes and the captures populate; it
 * does NOT score against `_oracle.ts` (that is the S5 slice).
 *
 * ── DOUBLE ENV GATE (per the plan-gate) ─────────────────────────────────────
 * This is the heaviest eval (~100 live-judge round-trips at full scale), so it is
 * gated behind BOTH `OPENROUTER_API_KEY` (present) AND `VEX_E2E_MEMORY_EVAL=1`.
 * The default `test:eval` run (key present, flag absent) does NOT run this suite.
 * Use the dedicated `test:eval:e2e` script. A 10-item subset (the S4 deliverable)
 * is selected via `VEX_E2E_SUBSET=10` (or the default `SUBSET_IDS`); the full 100
 * is S6.
 *
 * ── WHAT S4 ASSERTS ─────────────────────────────────────────────────────────
 *   1. the run executes end-to-end without crashing,
 *   2. the live judge is REACHED for the judge-path items (recordJudgeAttempt > 0),
 *   3. the capture is populated (every processed item has an ItemResult; door
 *      items have a door capture). NO oracle comparison.
 */

import { describe, it, expect, beforeAll } from "vitest";

import { resetDb, makeSession } from "../setup/fixtures.js";
import { reportCard } from "./_report-card.js";
import { ORACLE } from "./_oracle.js"; // S4: confirm the oracle imports (not scored yet).
import {
  runStream,
  resolveSubset,
  SUBSET_IDS,
  type ItemResult,
} from "./_sim-runner.js";

const SUITE = "e2e-memory-correctness";
const hasKey = !!process.env.OPENROUTER_API_KEY;
const e2eEnabled = process.env.VEX_E2E_MEMORY_EVAL === "1";

/** S4 runs the 10-item subset by default; `VEX_E2E_SUBSET` is the explicit knob. */
function selectSubsetIds(): readonly string[] {
  const raw = process.env.VEX_E2E_SUBSET;
  if (raw === undefined || raw === "10") return SUBSET_IDS;
  // A numeric override slices the canonical subset (defensive — never exceeds it).
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0 && n <= SUBSET_IDS.length) return SUBSET_IDS.slice(0, n);
  return SUBSET_IDS;
}

describe.skipIf(!hasKey || !e2eEnabled)("eval: e2e memory correctness (live, S4 runner)", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it(
    "runs the 10-item subset end-to-end through the real pipeline and populates the capture",
    async () => {
      // S4 sanity: the oracle module imports and is internally consistent (its
      // module-load coverage assert ran on import). Not scored against here.
      expect(Object.keys(ORACLE.predictions).length).toBeGreaterThan(0);
      expect(ORACLE.retrieval.length).toBeGreaterThan(0);

      const subsetIds = selectSubsetIds();
      const { memories, trades, regimes } = resolveSubset(subsetIds);

      // One agent session for the whole stream (the faithful seeders need it).
      const sessionId = await makeSession();

      const capture = await runStream({ sessionId, memories, trades, regimes });

      // ── 1. The run processed every chosen memory item. ──
      expect(capture.processedItemIds.length).toBe(subsetIds.length);
      for (const id of subsetIds) {
        expect(capture.perItem.has(id)).toBe(true);
      }

      // ── 2. Tally the per-item captures by kind + feed the F31 headline. ──
      let judgeReached = 0;
      let judgeValid = 0;
      let doorRejects = 0;
      let seeds = 0;
      let reconciles = 0;
      const verdicts: string[] = [];

      for (const id of subsetIds) {
        const result = capture.perItem.get(id);
        expect(result).toBeDefined();
        if (!result) continue;
        recordItemCapture(id, result);
        switch (result.kind) {
          case "judge": {
            if (result.reached) judgeReached += 1;
            if (result.verdictValid) judgeValid += 1;
            reportCard.recordJudgeAttempt({
              scenario: `${SUITE}/${id}`,
              reached: result.reached,
              valid: result.verdictValid,
              invalidReason: mapInvalidReason(result.invalidReason),
            });
            verdicts.push(
              result.verdictValid
                ? `${id}:${result.decisionType ?? "?"}`
                : `${id}:invalid(${result.invalidReason ?? "?"})`,
            );
            break;
          }
          case "door_reject":
            doorRejects += 1;
            verdicts.push(`${id}:door(${result.success ? "passed" : "rejected"})`);
            break;
          case "seed":
            seeds += 1;
            break;
          case "reconcile":
            reconciles += 1;
            verdicts.push(`${id}:reconcile(${result.terminalStatus})`);
            break;
          default: {
            const _exhaustive: never = result;
            throw new Error(`unhandled item result ${JSON.stringify(_exhaustive)}`);
          }
        }
      }

      // ── 3. The live judge was REACHED for the judge-path items. ──
      // The subset deliberately carries judge-path items (A01 / F03 / R01 / B02).
      // At least one must have escalated to the real judge (a call attempted),
      // else the run never exercised the load-bearing live-judge seam.
      expect(judgeReached).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log(
        `[e2e-s4] processed=${capture.processedItemIds.length} ` +
          `judgeReached=${judgeReached} judgeValid=${judgeValid} ` +
          `doorRejects=${doorRejects} seeds=${seeds} reconciles=${reconciles}\n` +
          `[e2e-s4] verdicts: ${verdicts.join("  ")}`,
      );

      reportCard.recordCheck(SUITE, {
        label: "S4 runner: 10-item subset executed end-to-end; capture populated; judge reached",
        pass: true,
        note:
          `processed=${capture.processedItemIds.length} judgeReached=${judgeReached} ` +
          `judgeValid=${judgeValid} doorRejects=${doorRejects} seeds=${seeds} reconciles=${reconciles}`,
      });
    },
    600_000,
  );
});

/** Record one per-item capture as a metrics-only check row (no candidate text). */
function recordItemCapture(id: string, result: ItemResult): void {
  switch (result.kind) {
    case "judge":
      reportCard.recordCheck(SUITE, {
        label: `item ${id}: judge path`,
        pass: result.reached,
        note: result.verdictValid
          ? `valid verdict=${result.decisionType ?? "?"} supersedes=${result.supersedesKnowledgeId ?? "—"} graphPlan=${result.hasGraphPlan}`
          : `reached=${result.reached} invalid=${result.invalidReason ?? "—"}`,
      });
      break;
    case "door_reject":
      reportCard.recordCheck(SUITE, {
        label: `item ${id}: door`,
        pass: true,
        note: `success=${result.success} candidate=${result.candidateId ? "yes" : "no"}`,
      });
      break;
    case "seed":
      reportCard.recordCheck(SUITE, {
        label: `item ${id}: seed`,
        pass: true,
        note: `via=${result.via} knowledgeId=${result.knowledgeId ?? "—"} candidate=${result.candidateId ? "yes" : "no"}`,
      });
      break;
    case "reconcile":
      reportCard.recordCheck(SUITE, {
        label: `item ${id}: reconcile`,
        pass: true,
        note: `status=${result.terminalStatus} lastError=${result.lastError ?? "—"} decision=${result.decisionType ?? "—"}`,
      });
      break;
    default: {
      const _exhaustive: never = result;
      throw new Error(`recordItemCapture: unhandled ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Map the runner's bounded invalid-reason string to the report-card enum. */
function mapInvalidReason(
  reason: string | null,
):
  | "schema_invalid"
  | "judge_timeout"
  | "judge_malformed"
  | "provider_config"
  | "judge_unknown"
  | null {
  switch (reason) {
    case "schema_invalid":
    case "judge_timeout":
    case "judge_malformed":
    case "provider_config":
    case "judge_unknown":
      return reason;
    case null:
      return null;
    default:
      return "judge_unknown";
  }
}
