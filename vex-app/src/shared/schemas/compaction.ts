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
