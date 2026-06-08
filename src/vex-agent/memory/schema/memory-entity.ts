/**
 * Memory v2 — `memory_entities` Zod boundary schema (S1d).
 *
 * Validates the trusted, typed shape the async memory_manager (S8) hands to the
 * `memory_entities` repo. NOT an agent-facing surface — the agent never asserts
 * graph nodes; S8 extracts/normalizes them from promoted knowledge_entries. This
 * stage DEFINES + TESTS the schema; S8 produces the values (incl. embeddings).
 *
 * `normalizeEntityName` is the SINGLE SOURCE for the canonical dedup key
 * (`memory_entities.normalized_name`) — the repo never recomputes it a different
 * way. It mirrors Graphiti's `_normalize_string_exact`: trim, lowercase, and
 * collapse internal whitespace runs to a single space.
 *
 * The embedding triplet (`embedding` / `embeddingModel` / `embeddingDim`) is
 * REQUIRED here (entities always carry a NAME embedding — D5); the producer
 * computes it. The substrate only validates length-vs-dim (repo fast-fail) and
 * the DB enforces the matching CHECK.
 *
 * Pure module: Zod schemas + derived types + the normalize helper. No DB, no
 * embeddings, no I/O.
 */

import { z } from "zod";

import {
  CANDIDATE_ENTITIES_MAX,
  CANDIDATE_ENTITY_MAX,
} from "@vex-agent/memory/schema/memory-candidate.js";
import { memoryEntityTypeSchema } from "@vex-agent/memory/schema/memory-entity-enums.js";

// ── Bounds (named so the contract is explicit and reused by tests) ──

/** Max display-name length accepted at the entity boundary (reuses candidate entity bound). */
export const ENTITY_NAME_MAX = CANDIDATE_ENTITY_MAX;
/** Max length of a single alias surface variant. */
export const ENTITY_ALIAS_MAX = CANDIDATE_ENTITY_MAX;
/** Max number of aliases per entity (reuses candidate entities cap). */
export const ENTITY_ALIASES_MAX = CANDIDATE_ENTITIES_MAX;
/** Max regional summary length (S8 fills; redacted upstream). */
export const ENTITY_SUMMARY_MAX = 4000;
/** Max embedding-model name length (names only, no secrets). */
export const ENTITY_EMBEDDING_MODEL_MAX = 200;

/**
 * Canonical normalization of an entity surface form into its dedup key. Trims
 * outer whitespace, lowercases, and collapses internal whitespace runs to a
 * single space (mirrors Graphiti `_normalize_string_exact`). This is the ONLY
 * place the `(entity_type, normalized_name)` dedup key is derived; the repo
 * applies it so a producer can never store a divergent key.
 */
export function normalizeEntityName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Entity input (validated before the repo's upsertEntity) ─────────

/**
 * The trusted shape S8 hands to `upsertEntity`. `.strict()` rejects unknown
 * keys. `normalizedName` is NOT accepted from the caller — it is DERIVED from
 * `name` via `normalizeEntityName` so the dedup key is single-source. System /
 * DB-owned columns (`id`, `validUntil`, `created_at`, `updated_at`) are absent.
 */
export const entityInputSchema = z
  .object({
    entityType: memoryEntityTypeSchema,
    // The display string is kept as-is, but it must contain a non-whitespace
    // character: the repo derives the dedup key via normalizeEntityName(name),
    // and a whitespace-only name would normalize to "" and trip
    // me_normalized_name_nonempty at the DB. Reject it at the boundary instead.
    name: z
      .string()
      .min(1)
      .max(ENTITY_NAME_MAX)
      .refine((v) => normalizeEntityName(v).length > 0, {
        message: "name must contain a non-whitespace character",
      }),
    aliases: z
      .array(z.string().min(1).max(ENTITY_ALIAS_MAX))
      .max(ENTITY_ALIASES_MAX)
      .default([]),
    summary: z.string().max(ENTITY_SUMMARY_MAX).default(""),
    attributes: z.record(z.string(), z.unknown()).default({}),
    embedding: z.array(z.number()).min(1),
    embeddingModel: z.string().min(1).max(ENTITY_EMBEDDING_MODEL_MAX),
    embeddingDim: z.number().int().positive(),
    validFrom: z.iso.datetime().optional(),
  })
  .strict();

/** Caller-facing input (PRE-parse: defaults for `aliases`/`summary`/`attributes`). */
export type EntityInput = z.input<typeof entityInputSchema>;

/** Validated entity input (POST-parse: defaults applied). */
export type ParsedEntityInput = z.output<typeof entityInputSchema>;
