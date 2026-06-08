/**
 * Memory v2 — `memory_edges` Zod boundary schema (S1d).
 *
 * Validates the trusted, typed shape the async memory_manager (S8) hands to the
 * `memory_edges` repo. NOT an agent-facing surface — S8 asserts directed
 * entity→entity relations between already-resolved entities.
 *
 * Two boundary invariants mirror the DB CHECKs so a malformed edge is rejected
 * BEFORE SQL:
 * - `med_no_self_loop`     ⇒ `sourceEntityId` must differ from `targetEntityId`.
 * - `med_embedding_triplet` ⇒ the FACT embedding is all-or-none: either ALL of
 *   `factEmbedding` / `embeddingModel` / `embeddingDim` are present, or NONE are.
 *   The edge fact vector is OPTIONAL (D5: not every edge carries a fact vector).
 *
 * `edgeInvalidationSchema` is the small patch shape for `invalidateEdge`
 * (plain retraction with no successor) — both fields optional.
 *
 * Pure module: Zod schemas + derived types. No DB, no embeddings, no I/O.
 */

import { z } from "zod";

import { memoryEdgeRelationSchema } from "@vex-agent/memory/schema/memory-edge-enums.js";

// ── Bounds (named so the contract is explicit and reused by tests) ──

/** Max NL fact-text length (S8 fills; redacted upstream). */
export const EDGE_FACT_MAX = 4000;
/** Max embedding-model name length (names only, no secrets). */
export const EDGE_EMBEDDING_MODEL_MAX = 200;

// ── Edge input (validated before the repo's upsertEdge / supersedeEdge) ──

/**
 * The trusted shape S8 hands to `upsertEdge` / `supersedeEdge`. `.strict()`
 * rejects unknown keys. The two refines mirror the DB CHECKs so an incoherent
 * edge fails at the boundary, not on a deferred constraint violation. System /
 * DB-owned columns (`id`, `validUntil`, `invalidatedAt`, `supersededByEdgeId`,
 * `created_at`, `updated_at`) are absent.
 */
export const edgeInputSchema = z
  .object({
    sourceEntityId: z.uuid(),
    targetEntityId: z.uuid(),
    relation: memoryEdgeRelationSchema,
    fact: z.string().max(EDGE_FACT_MAX).default(""),
    factEmbedding: z.array(z.number()).min(1).optional(),
    embeddingModel: z.string().min(1).max(EDGE_EMBEDDING_MODEL_MAX).optional(),
    embeddingDim: z.number().int().positive().optional(),
    originEntryId: z.number().int().positive().optional(),
    validFrom: z.iso.datetime().optional(),
  })
  .strict()
  .refine((v) => v.sourceEntityId !== v.targetEntityId, {
    message: "sourceEntityId and targetEntityId must differ (no self-loop edge)",
    path: ["targetEntityId"],
  })
  .refine(
    (v) => {
      // All-or-none fact-embedding triplet (mirrors med_embedding_triplet).
      const present =
        Number(v.factEmbedding !== undefined) +
        Number(v.embeddingModel !== undefined) +
        Number(v.embeddingDim !== undefined);
      return present === 0 || present === 3;
    },
    {
      message:
        "factEmbedding, embeddingModel, and embeddingDim must be supplied together or not at all",
      path: ["factEmbedding"],
    },
  );

/** Caller-facing input (PRE-parse: `fact` defaults to ""). */
export type EdgeInput = z.input<typeof edgeInputSchema>;

/** Validated edge input (POST-parse: defaults applied, refines enforced). */
export type ParsedEdgeInput = z.output<typeof edgeInputSchema>;

// ── Edge invalidation patch (validated before invalidateEdge) ───────

/**
 * Patch shape for a plain retraction (`invalidateEdge`). `validUntil` closes the
 * world-time interval; `supersededByEdgeId` is the optional explicit back-pointer
 * (set by `supersedeEdge`, not by callers of `invalidateEdge`). `.strict()`
 * rejects unknown keys.
 */
export const edgeInvalidationSchema = z
  .object({
    validUntil: z.iso.datetime().optional(),
    supersededByEdgeId: z.uuid().optional(),
  })
  .strict();

export type EdgeInvalidation = z.input<typeof edgeInvalidationSchema>;
