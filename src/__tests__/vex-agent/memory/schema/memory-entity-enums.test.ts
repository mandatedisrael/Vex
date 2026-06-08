/**
 * Lockstep guard: the SQL CHECK constraint ↔ the TS `as const` array ↔ the Zod
 * options for the `memory_entities.entity_type` bounded-vocabulary column (S1d).
 *
 * `MEMORY_ENTITY_TYPE` lives in TWO places that MUST stay identical:
 *   1. the named CHECK `me_entity_type_valid` in `db/migrations/001_initial.sql`
 *      (the DB enforces it at write time);
 *   2. the `as const` tuple + `z.enum(...)` in
 *      `vex-agent/memory/schema/memory-entity-enums.ts`.
 *
 * This test parses the `IN (...)` value list out of that named CHECK in the
 * SOURCE migration and asserts it equals the TS array AND the Zod `.options`.
 * Reuses the shared `parseCheckInList` parser (no duplication).
 */

import { describe, it, expect } from "vitest";

import {
  MEMORY_ENTITY_TYPE,
  memoryEntityTypeSchema,
} from "@vex-agent/memory/schema/memory-entity-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("memory-entity enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("entity_type CHECK equals MEMORY_ENTITY_TYPE and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "me_entity_type_valid", "entity_type");
    expect(sorted(sqlValues)).toEqual(sorted(MEMORY_ENTITY_TYPE));
    expect(sorted(sqlValues)).toEqual(sorted(memoryEntityTypeSchema.options));
    expect(memoryEntityTypeSchema.options).toEqual([...MEMORY_ENTITY_TYPE]);
  });

  it("fails loudly when the constraint is renamed or removed", () => {
    expect(() =>
      parseCheckInList(MIGRATION_SQL, "me_entity_type_does_not_exist", "entity_type"),
    ).toThrow(/not found in 001_initial\.sql/);
  });
});
