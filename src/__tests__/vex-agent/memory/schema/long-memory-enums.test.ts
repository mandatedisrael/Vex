/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options.
 *
 * Memory v2 introduces three bounded-vocabulary columns on `knowledge_entries`
 * (`maturity_state`, `influence_scope`, `decay_policy`). Their allowed values
 * live in TWO places that MUST stay identical:
 *   1. the named CHECK constraints in `db/migrations/001_initial.sql`
 *      (`ke_maturity_state_valid` / `ke_influence_scope_valid` /
 *      `ke_decay_policy_valid`), which the DB enforces at write time;
 *   2. the `as const` tuples + `z.enum(...)` in
 *      `vex-agent/memory/schema/long-memory-enums.ts`, which TS + import
 *      validation enforce.
 *
 * This test parses the `IN (...)` value list out of each named CHECK in the
 * SOURCE migration and asserts it equals the corresponding TS array AND the
 * Zod `.options`. Any drift (a value added to one side only, a rename, a
 * removed constraint) fails here instead of leaking into production.
 *
 * The migration is read from `src/vex-agent/db/migrations/001_initial.sql`
 * (the human-edited source of truth, not the build artifact) so a stale `dist/`
 * can never mask a drift in the source file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { getPackageRoot } from "@utils/package-assets.js";
import {
  MATURITY_STATES,
  INFLUENCE_SCOPES,
  DECAY_POLICIES,
  maturityStateSchema,
  influenceScopeSchema,
  decayPolicySchema,
} from "@vex-agent/memory/schema/long-memory-enums.js";

const MIGRATION_SQL = readFileSync(
  join(getPackageRoot(), "src", "vex-agent", "db", "migrations", "001_initial.sql"),
  "utf-8",
);

/**
 * Extract the quoted value list from a named CHECK of the form
 * `CONSTRAINT <name> CHECK (<column> IN ('a','b',...))`.
 *
 * Throws if the constraint is absent so a rename/removal fails loudly rather
 * than silently passing against an empty set.
 */
function parseCheckInList(sql: string, constraintName: string, column: string): string[] {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
    "i",
  );
  const match = re.exec(sql);
  if (!match) {
    throw new Error(
      `lockstep: named CHECK '${constraintName}' on column '${column}' not found in 001_initial.sql`,
    );
  }
  return match[1]!
    .split(",")
    .map((token) => token.trim().replace(/^'(.*)'$/, "$1"))
    .filter((token) => token.length > 0);
}

/** Order-independent set comparison via sorted copies. */
function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe("long-memory enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("maturity_state CHECK equals MATURITY_STATES and maturityStateSchema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "ke_maturity_state_valid", "maturity_state");
    expect(sorted(sqlValues)).toEqual(sorted(MATURITY_STATES));
    expect(sorted(sqlValues)).toEqual(sorted(maturityStateSchema.options));
    // Zod options mirror the as-const tuple exactly (same authoring order).
    expect(maturityStateSchema.options).toEqual([...MATURITY_STATES]);
  });

  it("influence_scope CHECK equals INFLUENCE_SCOPES and influenceScopeSchema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "ke_influence_scope_valid", "influence_scope");
    expect(sorted(sqlValues)).toEqual(sorted(INFLUENCE_SCOPES));
    expect(sorted(sqlValues)).toEqual(sorted(influenceScopeSchema.options));
    expect(influenceScopeSchema.options).toEqual([...INFLUENCE_SCOPES]);
  });

  it("decay_policy CHECK equals DECAY_POLICIES and decayPolicySchema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "ke_decay_policy_valid", "decay_policy");
    expect(sorted(sqlValues)).toEqual(sorted(DECAY_POLICIES));
    expect(sorted(sqlValues)).toEqual(sorted(decayPolicySchema.options));
    expect(decayPolicySchema.options).toEqual([...DECAY_POLICIES]);
  });

  it("guards against a missing/renamed constraint (parser is fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "ke_does_not_exist", "maturity_state")).toThrow(
      /not found in 001_initial\.sql/,
    );
  });

  // influence_scope is doctrine-bound to advisory|retrieval_boost only — the
  // forbidden execution-coupling values must never reappear in the schema.
  it("influence_scope never includes execution_constraint or sizing_hint", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "ke_influence_scope_valid", "influence_scope");
    expect(sqlValues).not.toContain("execution_constraint");
    expect(sqlValues).not.toContain("sizing_hint");
    expect(INFLUENCE_SCOPES as readonly string[]).not.toContain("execution_constraint");
    expect(INFLUENCE_SCOPES as readonly string[]).not.toContain("sizing_hint");
  });
});
