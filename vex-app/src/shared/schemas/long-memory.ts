/**
 * Long-memory schemas — read-only view of the GLOBAL long-term memory store
 * (memory-system S9 rewire; rows live in the `knowledge_entries` table).
 *
 * Sanitized for the renderer: the DTO deliberately EXCLUDES `content_md`,
 * `source_refs`, `content_hash`, and all embedding columns — the list shows
 * short-form metadata only (kind/title/summary/tags/confidence/status/
 * source/maturityState). The lifecycle (promotion, supersede, invalidation,
 * archival) is owned by the agent's memory manager — there is deliberately
 * NO mutation surface here. Statuses + sources + maturity states are
 * re-declared (shared/ must not import `src/vex-agent`); the sets mirror the
 * engine and a drift surfaces as a boundary parse failure.
 */

import { z } from "zod";

export const LONG_MEMORY_LIST_DEFAULT_LIMIT = 100;
export const LONG_MEMORY_LIST_MAX_LIMIT = 500;

/** Mirrors engine `KnowledgeStatus` (knowledge/policy.ts). */
export const LONG_MEMORY_STATUSES = [
  "active",
  "superseded",
  "invalidated",
  "archived",
] as const;
export const longMemoryStatusSchema = z.enum(LONG_MEMORY_STATUSES);
export type LongMemoryStatusDto = z.infer<typeof longMemoryStatusSchema>;

/** Mirrors engine `source` provenance classification (migration 018). */
export const LONG_MEMORY_SOURCES = [
  "observed",
  "user_confirmed",
  "inferred",
  "hypothesis",
] as const;
export const longMemorySourceSchema = z.enum(LONG_MEMORY_SOURCES);
export type LongMemorySourceDto = z.infer<typeof longMemorySourceSchema>;

/** Mirrors engine `MaturityState` (memory/schema/long-memory-enums.ts). */
export const LONG_MEMORY_MATURITY_STATES = [
  "probationary",
  "established",
  "reinforced",
  "decayed",
] as const;
export const longMemoryMaturityStateSchema = z.enum(
  LONG_MEMORY_MATURITY_STATES,
);
export type LongMemoryMaturityStateDto = z.infer<
  typeof longMemoryMaturityStateSchema
>;

/**
 * Input for `longMemory.list`. `status` omitted = all statuses (the panel
 * lists everything, visibly labeled). `limit` is bounded — never a
 * caller-controlled unbounded scan.
 */
export const longMemoryListInputSchema = z
  .object({
    status: longMemoryStatusSchema.optional(),
    limit: z
      .number()
      .int()
      .positive()
      .max(LONG_MEMORY_LIST_MAX_LIMIT)
      .default(LONG_MEMORY_LIST_DEFAULT_LIMIT),
  })
  .strict();
export type LongMemoryListInput = z.infer<typeof longMemoryListInputSchema>;

/**
 * One long-memory entry, sanitized. `source` / `maturityState` are `null`
 * when a (legacy) row carries a value outside the known set rather than
 * failing the boundary.
 */
export const longMemoryEntryDtoSchema = z
  .object({
    id: z.number().int().positive(),
    kind: z.string(),
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    confidence: z.number().nullable(),
    status: longMemoryStatusSchema,
    source: longMemorySourceSchema.nullable(),
    maturityState: longMemoryMaturityStateSchema.nullable(),
    pinned: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type LongMemoryEntryDto = z.infer<typeof longMemoryEntryDtoSchema>;

/** Result for `longMemory.list` — always an array (global store, no scope). */
export const longMemoryListResultSchema = z.array(longMemoryEntryDtoSchema);
export type LongMemoryListResult = z.infer<typeof longMemoryListResultSchema>;
