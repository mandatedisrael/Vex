/**
 * Lockstep guard: the SQL CHECK constraint ↔ the TS `as const` array ↔ the Zod
 * options for the `memory_edges.relation` bounded-vocabulary column (S1d).
 *
 * `MEMORY_EDGE_RELATION` lives in TWO places that MUST stay identical:
 *   1. the named CHECK `med_relation_valid` in `db/migrations/001_initial.sql`
 *      (the DB enforces it at write time);
 *   2. the `as const` tuple + `z.enum(...)` in
 *      `vex-agent/memory/schema/memory-edge-enums.ts`.
 *
 * This test parses the `IN (...)` value list out of that named CHECK in the
 * SOURCE migration and asserts it equals the TS array AND the Zod `.options`.
 * Reuses the shared `parseCheckInList` parser (no duplication).
 */

import { describe, it, expect } from "vitest";

import {
  MEMORY_EDGE_RELATION,
  memoryEdgeRelationSchema,
} from "@vex-agent/memory/schema/memory-edge-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("memory-edge enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("relation CHECK equals MEMORY_EDGE_RELATION and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "med_relation_valid", "relation");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_EDGE_RELATION));
    expect(sorted(sqlValues)).toEqual(sorted(memoryEdgeRelationSchema.options));
    expect(memoryEdgeRelationSchema.options).toEqual([...MEMORY_EDGE_RELATION]);
  });

  it("includes related_to as the generic fallback relation", () => {
    expect(memoryEdgeRelationSchema.options).toContain("related_to");
  });

  it("fails loudly when the constraint is renamed or removed", () => {
    expect(() =>
      parseCheckInList(MIGRATION_SQL, "med_relation_does_not_exist", "relation"),
    ).toThrow(/not found in 001_initial\.sql/);
  });
});
