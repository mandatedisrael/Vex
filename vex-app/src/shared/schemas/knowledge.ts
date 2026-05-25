/**
 * Knowledge schemas — read-only management view of the GLOBAL
 * `knowledge_entries` store (agent integration stage 7-2a).
 *
 * Sanitized for the renderer: the DTO deliberately EXCLUDES `content_md`,
 * `source_refs`, `content_hash`, and all embedding columns — the list shows
 * short-form metadata only (kind/title/summary/tags/confidence/status/
 * source). The renderer never controls the agent's learning loop here; this
 * is an audit/management surface. Statuses + sources are re-declared (shared/
 * must not import `src/vex-agent`); the sets mirror the engine and a drift
 * surfaces as a boundary parse failure.
 */

import { z } from "zod";

export const KNOWLEDGE_LIST_DEFAULT_LIMIT = 100;
export const KNOWLEDGE_LIST_MAX_LIMIT = 500;

/** Mirrors engine `KnowledgeStatus` (knowledge/policy.ts). */
export const KNOWLEDGE_STATUSES = [
  "active",
  "superseded",
  "invalidated",
  "archived",
] as const;
export const knowledgeStatusSchema = z.enum(KNOWLEDGE_STATUSES);
export type KnowledgeStatusDto = z.infer<typeof knowledgeStatusSchema>;

/** Mirrors engine knowledge `source` classification (migration 018). */
export const KNOWLEDGE_SOURCES = [
  "observed",
  "user_confirmed",
  "inferred",
  "hypothesis",
] as const;
export const knowledgeSourceSchema = z.enum(KNOWLEDGE_SOURCES);
export type KnowledgeSourceDto = z.infer<typeof knowledgeSourceSchema>;

/**
 * Input for `knowledge.list`. `status` omitted = all statuses (management
 * view lists everything, visibly labeled). `limit` is bounded — never a
 * caller-controlled unbounded scan.
 */
export const knowledgeListInputSchema = z
  .object({
    status: knowledgeStatusSchema.optional(),
    limit: z
      .number()
      .int()
      .positive()
      .max(KNOWLEDGE_LIST_MAX_LIMIT)
      .default(KNOWLEDGE_LIST_DEFAULT_LIMIT),
  })
  .strict();
export type KnowledgeListInput = z.infer<typeof knowledgeListInputSchema>;

/**
 * One knowledge entry, sanitized. `source` is `null` when a (legacy) row
 * carries a value outside the known set rather than failing the boundary.
 */
export const knowledgeEntryDtoSchema = z
  .object({
    id: z.number().int().positive(),
    kind: z.string(),
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    confidence: z.number().nullable(),
    status: knowledgeStatusSchema,
    source: knowledgeSourceSchema.nullable(),
    sourceSession: z.string().nullable(),
    pinned: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type KnowledgeEntryDto = z.infer<typeof knowledgeEntryDtoSchema>;

/** Result for `knowledge.list` — always an array (global store, no scope). */
export const knowledgeListResultSchema = z.array(knowledgeEntryDtoSchema);
export type KnowledgeListResult = z.infer<typeof knowledgeListResultSchema>;

// ── Disable/archive mutation (stage 7-2b) ────────────────────────────────
// The only user-settable transitions (engine `updateStatus` guards on
// `status='active'` and is ONE-WAY — there is no re-activate path).

export const knowledgeUpdatableStatusSchema = z.enum([
  "invalidated",
  "archived",
]);
export type KnowledgeUpdatableStatus = z.infer<
  typeof knowledgeUpdatableStatusSchema
>;

export const knowledgeUpdateStatusInputSchema = z
  .object({
    id: z.number().int().positive(),
    status: knowledgeUpdatableStatusSchema,
    /** Optional audit note (reserved; the 7-2b UI does not yet capture one). */
    reason: z.string().max(500).optional(),
  })
  .strict();
export type KnowledgeUpdateStatusInput = z.infer<
  typeof knowledgeUpdateStatusInputSchema
>;

/** Ack for `knowledge.updateStatus` — the entry id + its new status. */
export const knowledgeUpdateStatusResultSchema = z
  .object({
    id: z.number().int().positive(),
    status: knowledgeUpdatableStatusSchema,
  })
  .strict();
export type KnowledgeUpdateStatusResult = z.infer<
  typeof knowledgeUpdateStatusResultSchema
>;
