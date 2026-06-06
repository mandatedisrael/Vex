/**
 * Jupiter Prediction `leaderboards` response schemas (codex-002).
 */

import { z } from "zod";

// ── Leaderboards ───────────────────────────────────────────────────

const leaderboardSummaryPeriodSchema = z
  .object({
    totalVolumeUsd: z.string(),
    predictionsCount: z.number(),
  })
  .passthrough();

const leaderboardEntrySchema = z
  .object({
    ownerPubkey: z.string(),
    realizedPnlUsd: z.string(),
    totalVolumeUsd: z.string(),
    predictionsCount: z.number(),
    correctPredictions: z.number(),
    wrongPredictions: z.number(),
    winRatePct: z.string(),
    period: z.string(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
  })
  .passthrough();

export const jupiterPredictionLeaderboardsResponseSchema = z
  .object({
    data: z.array(leaderboardEntrySchema),
    summary: z
      .object({
        all_time: leaderboardSummaryPeriodSchema,
        weekly: leaderboardSummaryPeriodSchema,
        monthly: leaderboardSummaryPeriodSchema,
      })
      .passthrough(),
  })
  .passthrough();
