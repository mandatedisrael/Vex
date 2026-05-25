/**
 * Compaction schemas — read-only Track-2 worker status for the runtime bar
 * (agent integration stage 7-1).
 *
 * The Track-2 compact-jobs executor is owned by Electron main; the renderer
 * never controls it. This domain exposes only a status projection of the
 * session's `compact_jobs` rows so the chat runtime bar can show whether a
 * compaction is queued, running, or terminally failed.
 *
 * The status literal mirrors the engine's internal `CompactJobStatus`
 * (`src/vex-agent/db/repos/compact-jobs/types.ts`). It is re-declared here
 * (not imported) because shared/ must not depend on `src/vex-agent`. The set
 * is stable; a drift would surface as a Zod parse failure at the boundary.
 */

import { z } from "zod";

export const COMPACT_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "permanently_failed",
] as const;

export const compactJobStatusSchema = z.enum(COMPACT_JOB_STATUSES);
export type CompactJobStatusDto = z.infer<typeof compactJobStatusSchema>;

export const compactionStatusInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type CompactionStatusInput = z.infer<typeof compactionStatusInputSchema>;

/**
 * The session's most recent compact job (by insertion order). `null` when
 * the session has no compact jobs yet — a normal state, not an error.
 *
 *  - `updatedAt` is the job's most meaningful timestamp:
 *    `COALESCE(completed_at, inference_completed_at, heartbeat_at,
 *    started_at, created_at)` — so a completed/running job reflects its
 *    terminal/progress time rather than enqueue time.
 */
export const compactionLatestJobSchema = z
  .object({
    status: compactJobStatusSchema,
    checkpointGeneration: z.number().int().min(0),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CompactionLatestJob = z.infer<typeof compactionLatestJobSchema>;

/**
 * Compaction status for one session.
 *
 *  - `latest` — the most recent job, or `null` when none exist.
 *  - `activeCount` — jobs still expected to produce work
 *    (`pending` + `running` + `failed`-with-retry). Drives the
 *    "queued"/"compacting" indicator; `permanently_failed` is terminal and
 *    excluded.
 */
export const compactionStatusDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    latest: compactionLatestJobSchema.nullable(),
    activeCount: z.number().int().min(0),
  })
  .strict();
export type CompactionStatusDto = z.infer<typeof compactionStatusDtoSchema>;

/**
 * Result for `compaction.getStatus` — `null` when the session is unknown,
 * soft-deleted, or outside the app scope (mirrors `usage.getContextWindow`).
 * No fabricated status for a session that does not exist.
 */
export const compactionStatusResultSchema = compactionStatusDtoSchema.nullable();
export type CompactionStatusResult = z.infer<
  typeof compactionStatusResultSchema
>;

// ── Compaction history (stage 7-2a) ──────────────────────────────────────
// Replayable timeline of a session's compaction generations — the "what
// happened" surface in the knowledge/memory panel (until inline transcript
// markers become possible at stage 08). Read-only, app-scoped.

export const COMPACTION_HISTORY_DEFAULT_LIMIT = 50;
export const COMPACTION_HISTORY_MAX_LIMIT = 200;

export const compactionHistoryInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    limit: z
      .number()
      .int()
      .positive()
      .max(COMPACTION_HISTORY_MAX_LIMIT)
      .default(COMPACTION_HISTORY_DEFAULT_LIMIT),
  })
  .strict();
export type CompactionHistoryInput = z.infer<
  typeof compactionHistoryInputSchema
>;

/** One compaction generation's lifecycle + the transcript range it covered. */
export const compactionHistoryItemSchema = z
  .object({
    checkpointGeneration: z.number().int().min(0),
    status: compactJobStatusSchema,
    sourceStartMessageId: z.number().int().nullable(),
    sourceEndMessageId: z.number().int().nullable(),
    chunksInserted: z.number().int().min(0),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CompactionHistoryItem = z.infer<typeof compactionHistoryItemSchema>;

/**
 * Result for `compaction.listHistory` — `null` for an unknown/foreign/
 * deleted session; an empty array when the session has no compaction jobs.
 */
export const compactionHistoryResultSchema = z
  .array(compactionHistoryItemSchema)
  .nullable();
export type CompactionHistoryResult = z.infer<
  typeof compactionHistoryResultSchema
>;
