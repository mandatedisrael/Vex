/**
 * Session-memory schemas — read-only view of per-session `session_memories`
 * (agent integration stage 7-2a).
 *
 * Sanitized HARD: the DTO EXCLUDES every narrative column (`body_md`,
 * `happened_md`, `did_md`, `tried_md`), the raw `outstanding_items` array,
 * all embedding columns, and hashes. Outstanding work is exposed as COUNTS
 * only (computed in SQL). Memories are read-only here — the engine repo has
 * no user-facing disable path, so this surface only lists what the agent
 * learned. Session-scoped results are `null` for an unknown/foreign/deleted
 * session (no fabricated stats), mirroring `usage.getContextWindow`.
 */

import { z } from "zod";

export const SESSION_MEMORY_LIST_DEFAULT_LIMIT = 50;
export const SESSION_MEMORY_LIST_MAX_LIMIT = 200;

/** Mirrors engine session-memory status (migration 016). */
export const SESSION_MEMORY_STATUSES = [
  "active",
  "superseded",
  "merged_into",
] as const;
export const sessionMemoryStatusSchema = z.enum(SESSION_MEMORY_STATUSES);
export type SessionMemoryStatusDto = z.infer<typeof sessionMemoryStatusSchema>;

export const sessionMemoryListInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    limit: z
      .number()
      .int()
      .positive()
      .max(SESSION_MEMORY_LIST_MAX_LIMIT)
      .default(SESSION_MEMORY_LIST_DEFAULT_LIMIT),
  })
  .strict();
export type SessionMemoryListInput = z.infer<
  typeof sessionMemoryListInputSchema
>;

/**
 * One session-memory chunk, sanitized. Categorization arrays + theme +
 * importance/confidence are safe; narrative bodies are NOT included.
 * Outstanding work is open/resolved COUNTS only.
 */
export const sessionMemoryDtoSchema = z
  .object({
    id: z.number().int().positive(),
    theme: z.string(),
    themeSource: z.string().nullable(),
    entities: z.array(z.string()),
    protocols: z.array(z.string()),
    errorClasses: z.array(z.string()),
    chains: z.array(z.string()),
    tasks: z.array(z.string()),
    importance: z.number().int().nullable(),
    confidence: z.number().nullable(),
    status: sessionMemoryStatusSchema,
    checkpointGeneration: z.number().int().min(0),
    sourceStartMessageId: z.number().int().nullable(),
    sourceEndMessageId: z.number().int().nullable(),
    outstandingOpenCount: z.number().int().min(0),
    outstandingResolvedCount: z.number().int().min(0),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SessionMemoryDto = z.infer<typeof sessionMemoryDtoSchema>;

/**
 * Result for `memory.listSession` — `null` for an unknown/foreign/deleted
 * session; an empty array when the session exists but has no memories.
 */
export const sessionMemoryListResultSchema = z
  .array(sessionMemoryDtoSchema)
  .nullable();
export type SessionMemoryListResult = z.infer<
  typeof sessionMemoryListResultSchema
>;

export const memoryStatsInputSchema = z
  .object({ sessionId: z.string().uuid() })
  .strict();
export type MemoryStatsInput = z.infer<typeof memoryStatsInputSchema>;

/** Aggregate counts for the session's memory store (banner-style). */
export const memoryStatsDtoSchema = z
  .object({
    activeCount: z.number().int().min(0),
    compactCount: z.number().int().min(0),
    unresolvedOutstandingCount: z.number().int().min(0),
    recentThemes: z.array(z.string()),
  })
  .strict();
export type MemoryStatsDto = z.infer<typeof memoryStatsDtoSchema>;

/** Result for `memory.getStats` — `null` for an unknown/foreign/deleted session. */
export const memoryStatsResultSchema = memoryStatsDtoSchema.nullable();
export type MemoryStatsResult = z.infer<typeof memoryStatsResultSchema>;
