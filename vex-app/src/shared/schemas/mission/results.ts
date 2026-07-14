/**
 * Mission results ledger — read-only transport schemas for
 * `mission.listResults` / `mission.getResultForRun`.
 *
 * The ledger is written by the engine (migration 041 + capture hooks in
 * `engine/mission/mission-results-capture.ts`); these are the renderer-
 * facing reads for the Mission History view and the post-mission summary
 * card. Both queries are PER-WALLET — there is no "list every wallet's
 * missions" read.
 *
 * Naming: "mission result (ETH)", never "performance" — the number is an
 * honest ETH-denominated PnL record, not a guarantee of future results.
 * `stopReason` is the raw engine `StopReason` (mirrors
 * `src/vex-agent/engine/types.ts`); mapping it to a display outcome (e.g. a
 * reached time-box is not a failure) is a pure function in the renderer
 * model, never in this schema or in SQL.
 */

import { z } from "zod";

const MAX_RESULTS_LIMIT = 100;
const DEFAULT_RESULTS_LIMIT = 50;

/** Mirrors `mission_results.outcome` (migration 041) — the RAW run-level outcome. */
export const missionResultOutcomeSchema = z.enum([
  "running",
  "completed",
  "cancelled",
  "failed",
  "stopped",
]);
export type MissionResultOutcome = z.infer<typeof missionResultOutcomeSchema>;

export const missionResultDtoSchema = z
  .object({
    missionRunId: z.string().min(1),
    seqNo: z.number().int().positive(),
    goalSnippet: z.string().nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    durationS: z.number().int().nullable(),
    bankrollStartEth: z.number().nullable(),
    bankrollEndEth: z.number().nullable(),
    pnlEth: z.number().nullable(),
    pnlPct: z.number().nullable(),
    ethPriceUsdEnd: z.number().nullable(),
    trades: z.number().int().nonnegative(),
    outcome: missionResultOutcomeSchema,
    /** Raw engine StopReason (e.g. "goal_reached", "deadline_reached"), or null. */
    stopReason: z.string().nullable(),
    openPositionsCount: z.number().int().nonnegative(),
  })
  .strict();
export type MissionResultDto = z.infer<typeof missionResultDtoSchema>;

// ── listResults (per-wallet history, newest first) ──────────────

export const missionListResultsInputSchema = z
  .object({
    walletAddress: z.string().min(1),
    limit: z.number().int().min(1).max(MAX_RESULTS_LIMIT).optional(),
  })
  .strict();
export type MissionListResultsInput = z.infer<typeof missionListResultsInputSchema>;

export const missionListResultsResultSchema = z.array(missionResultDtoSchema);
export type MissionListResultsResult = z.infer<typeof missionListResultsResultSchema>;

export const DEFAULT_MISSION_RESULTS_LIMIT = DEFAULT_RESULTS_LIMIT;

// ── getResultForRun (single run, e.g. the post-mission summary card) ────

export const missionGetResultForRunInputSchema = z
  .object({
    missionRunId: z.string().min(1),
    walletAddress: z.string().min(1),
  })
  .strict();
export type MissionGetResultForRunInput = z.infer<typeof missionGetResultForRunInputSchema>;

export const missionGetResultForRunResultSchema = missionResultDtoSchema.nullable();
export type MissionGetResultForRunResult = z.infer<typeof missionGetResultForRunResultSchema>;
