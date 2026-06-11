/**
 * LLM entity-extraction output schema (S8 §4). The extractor is consulted ONLY
 * when a candidate's verdict resolved to promote/supersede (F1) — its output is
 * UNTRUSTED model text and this schema is the boundary that bounds it
 * (anti-poisoning): every cap here is DELIBERATELY TIGHTER than the S1d
 * substrate (`name` 120 < 256, aliases 8 < 64, alias 64 < 256, summary 500 <
 * 4000, fact 300 < 4000), so a runaway extraction can never saturate the graph.
 *
 * Closed vocabularies: `type` ∈ MEMORY_ENTITY_TYPE (×8) and `relation` ∈
 * MEMORY_EDGE_RELATION (×8) — the SAME enums the DB CHECKs mirror, so an
 * out-of-vocab hallucination fails the parse and the whole extraction is
 * dropped (fail-open: the lesson promotes WITHOUT a graph, never with a
 * polluted one).
 *
 * Structural refines:
 *   - every edge endpoint must reference a DECLARED entity name (matched on
 *     `normalizeEntityName` so the LLM's case/whitespace drift cannot orphan an
 *     edge);
 *   - no self-loops (source ≠ target after normalization).
 *
 * Pure module: Zod schemas + derived types + bound constants. No DB, no I/O.
 */

import { z } from "zod";

import { memoryEntityTypeSchema } from "@vex-agent/memory/schema/memory-entity-enums.js";
import { memoryEdgeRelationSchema } from "@vex-agent/memory/schema/memory-edge-enums.js";
import { normalizeEntityName } from "@vex-agent/memory/schema/memory-entity.js";

// ── Bounds (each TIGHTER than the S1d substrate — anti-poisoning) ──

/** Max entities one extraction may assert. */
export const EXTRACTION_ENTITIES_MAX = 8;
/** Max canonical-name length (substrate allows 256). */
export const EXTRACTION_ENTITY_NAME_MAX = 120;
/** Max aliases per entity (substrate allows 64). */
export const EXTRACTION_ALIASES_MAX = 8;
/** Max length of a single alias (substrate allows 256). */
export const EXTRACTION_ALIAS_MAX = 64;
/** Max entity summary length (substrate allows 4000). */
export const EXTRACTION_SUMMARY_MAX = 500;
/** Max edges one extraction may assert. */
export const EXTRACTION_EDGES_MAX = 8;
/** Max edge fact length (substrate allows 4000). */
export const EXTRACTION_FACT_MAX = 300;

// ── Entity / edge shapes ─────────────────────────────────────────

const extractedEntitySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(EXTRACTION_ENTITY_NAME_MAX)
      .refine((v) => normalizeEntityName(v).length > 0, {
        message: "name must contain a non-whitespace character",
      }),
    type: memoryEntityTypeSchema,
    aliases: z
      .array(z.string().min(1).max(EXTRACTION_ALIAS_MAX))
      .max(EXTRACTION_ALIASES_MAX)
      .optional()
      .default([]),
    summary: z.string().max(EXTRACTION_SUMMARY_MAX).optional(),
  })
  .strict();

const extractedEdgeSchema = z
  .object({
    source: z.string().min(1).max(EXTRACTION_ENTITY_NAME_MAX),
    target: z.string().min(1).max(EXTRACTION_ENTITY_NAME_MAX),
    relation: memoryEdgeRelationSchema,
    fact: z.string().max(EXTRACTION_FACT_MAX).optional(),
  })
  .strict();

// ── Full extraction ──────────────────────────────────────────────

/**
 * The extractor's full output. `.strict()` everywhere so an injected
 * "add field X" cannot smuggle data through the contract (regime-prompt
 * precedent). `edges` defaults to [] — an entity-only lesson is valid.
 */
export const entityExtractionSchema = z
  .object({
    entities: z.array(extractedEntitySchema).max(EXTRACTION_ENTITIES_MAX),
    edges: z.array(extractedEdgeSchema).max(EXTRACTION_EDGES_MAX).optional().default([]),
  })
  .strict()
  .refine(
    (v) => {
      const declared = new Set(v.entities.map((e) => normalizeEntityName(e.name)));
      return v.edges.every(
        (e) =>
          declared.has(normalizeEntityName(e.source)) &&
          declared.has(normalizeEntityName(e.target)),
      );
    },
    { message: "edge endpoints must reference declared entity names", path: ["edges"] },
  )
  .refine(
    (v) =>
      v.edges.every(
        (e) => normalizeEntityName(e.source) !== normalizeEntityName(e.target),
      ),
    { message: "edges must not be self-loops", path: ["edges"] },
  );

export type ExtractedEntity = z.output<typeof extractedEntitySchema>;
export type ExtractedEdge = z.output<typeof extractedEdgeSchema>;
export type EntityExtraction = z.output<typeof entityExtractionSchema>;
