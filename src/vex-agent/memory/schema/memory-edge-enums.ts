/**
 * Memory v2 — knowledge-graph edge-relation bounded-vocabulary enum (S1d). The
 * SINGLE SOURCE OF TRUTH for the `relation` column on `memory_edges`.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): the `as const` tuple here is mirrored by the
 * named CHECK constraint `med_relation_valid` in `db/migrations/001_initial.sql`
 * (the DB enforces it at write time). The drift guard in
 * `__tests__/vex-agent/memory/schema/memory-edge-enums.test.ts` parses that
 * CHECK's value list and asserts it equals BOTH this array AND the matching
 * `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Edges are DIRECTED (`source`→`target`); a symmetric relation (e.g.
 * `competes_with`) is handled by the producer (S8) choosing the orientation.
 * `related_to` is the generic fallback so S8 is never blocked by an
 * un-classifiable relation.
 *
 * Pure module: `as const` tuple + Zod schema + derived type. No DB, no I/O.
 */

import { z } from "zod";

// ── relation ────────────────────────────────────────────────────
export const MEMORY_EDGE_RELATION = [
  "traded_on",
  "uses",
  "holds",
  "competes_with",
  "correlates_with",
  "part_of",
  "supersedes",
  "related_to",
] as const;

export const memoryEdgeRelationSchema = z.enum(MEMORY_EDGE_RELATION);
export type MemoryEdgeRelation = z.infer<typeof memoryEdgeRelationSchema>;
