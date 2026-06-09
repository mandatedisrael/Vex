/**
 * Lockstep guard: SQL CHECK constraints ↔ TS `as const` arrays ↔ Zod options
 * for the `knowledge_maturity_events` bounded-vocabulary columns (S6a).
 *
 * Three closed enums (`event`, `reason_code`, `decided_by`) plus the two
 * maturity-state columns (`from_state` / `to_state`) each live in TWO places that
 * MUST stay identical:
 *   1. the named CHECK constraints in `db/migrations/001_initial.sql`
 *      (`kme_event_valid` / `kme_reason_code_valid` / `kme_decided_by_valid` /
 *      `kme_from_state_valid` / `kme_to_state_valid`);
 *   2. the `as const` tuples + `z.enum(...)` in
 *      `vex-agent/memory/schema/knowledge-maturity-event.ts` (and, for the
 *      maturity-state columns, the shared `MATURITY_STATES` vocab).
 *
 * Doctrine (genesis §950-976): a maturity event is an append-only AUDIT record —
 * `reason_code` is a CLOSED cause vocabulary (no free-text → no secret leak) and
 * `decided_by` is `system`/`manager`, never the agent.
 */

import { describe, it, expect } from "vitest";

import {
  MATURITY_EVENTS,
  MATURITY_REASON_CODES,
  MATURITY_DECIDED_BY,
  maturityEventSchema,
  maturityReasonCodeSchema,
  maturityDecidedBySchema,
} from "@vex-agent/memory/schema/knowledge-maturity-event.js";
import { MATURITY_STATES } from "@vex-agent/memory/schema/long-memory-enums.js";
import { MIGRATION_SQL, parseCheckInList, sorted } from "./_lockstep.js";

describe("knowledge-maturity-event enums ↔ 001_initial.sql CHECK lockstep", () => {
  it("event CHECK equals MATURITY_EVENTS and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "kme_event_valid", "event");
    expect(sorted(sqlValues)).toEqual(sorted(MATURITY_EVENTS));
    expect(sorted(sqlValues)).toEqual(sorted(maturityEventSchema.options));
    expect(maturityEventSchema.options).toEqual([...MATURITY_EVENTS]);
  });

  it("reason_code CHECK equals MATURITY_REASON_CODES and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "kme_reason_code_valid", "reason_code");
    expect(sorted(sqlValues)).toEqual(sorted(MATURITY_REASON_CODES));
    expect(sorted(sqlValues)).toEqual(sorted(maturityReasonCodeSchema.options));
    expect(maturityReasonCodeSchema.options).toEqual([...MATURITY_REASON_CODES]);
  });

  it("decided_by CHECK equals MATURITY_DECIDED_BY and schema.options", () => {
    const sqlValues = parseCheckInList(MIGRATION_SQL, "kme_decided_by_valid", "decided_by");
    expect(sorted(sqlValues)).toEqual(sorted(MATURITY_DECIDED_BY));
    expect(sorted(sqlValues)).toEqual(sorted(maturityDecidedBySchema.options));
    expect(maturityDecidedBySchema.options).toEqual([...MATURITY_DECIDED_BY]);
  });

  it("from_state / to_state CHECKs reuse the shared maturity-state vocabulary", () => {
    const fromValues = parseCheckInList(MIGRATION_SQL, "kme_from_state_valid", "from_state");
    const toValues = parseCheckInList(MIGRATION_SQL, "kme_to_state_valid", "to_state");
    expect(sorted(fromValues)).toEqual(sorted(MATURITY_STATES));
    expect(sorted(toValues)).toEqual(sorted(MATURITY_STATES));
  });

  it("guards against a missing/renamed constraint (parser is fail-loud)", () => {
    expect(() => parseCheckInList(MIGRATION_SQL, "kme_does_not_exist", "event")).toThrow(
      /not found in 001_initial\.sql/,
    );
  });

  it("maturity-event enums carry no execution-coupling vocabulary (doctrine)", () => {
    const all: readonly string[] = [
      ...MATURITY_EVENTS,
      ...MATURITY_REASON_CODES,
      ...MATURITY_DECIDED_BY,
    ];
    expect(all).not.toContain("execution_constraint");
    expect(all).not.toContain("sizing_hint");
  });
});

// ── Input boundary schema ────────────────────────────────────────

describe("recordMaturityEventInputSchema — boundary validation", () => {
  it("accepts a well-formed reinforcement event and defaults triggerRefs/decidedBy", async () => {
    const { recordMaturityEventInputSchema } = await import(
      "@vex-agent/memory/schema/knowledge-maturity-event.js"
    );
    const parsed = recordMaturityEventInputSchema.parse({
      entryId: 7,
      event: "matured",
      fromState: "probationary",
      toState: "established",
      reasonCode: "recurrence_confirmation",
      activationBefore: 0.5,
      activationAfter: 0.75,
    });
    expect(parsed.triggerRefs).toEqual({});
    expect(parsed.decidedBy).toBe("system");
  });

  it("rejects an activation value outside [0,1]", async () => {
    const { recordMaturityEventInputSchema } = await import(
      "@vex-agent/memory/schema/knowledge-maturity-event.js"
    );
    const result = recordMaturityEventInputSchema.safeParse({
      entryId: 1,
      event: "decayed",
      fromState: "established",
      toState: "decayed",
      reasonCode: "time_decay",
      activationBefore: 1.2,
      activationAfter: 0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown triggerRefs key (strict pointer-only bag)", async () => {
    const { recordMaturityEventInputSchema } = await import(
      "@vex-agent/memory/schema/knowledge-maturity-event.js"
    );
    const result = recordMaturityEventInputSchema.safeParse({
      entryId: 1,
      event: "reinforced",
      fromState: "reinforced",
      toState: "reinforced",
      reasonCode: "recurrence_confirmation",
      activationBefore: 0.9,
      activationAfter: 1.0,
      triggerRefs: { rawContent: "secret-do-not-store" },
    });
    expect(result.success).toBe(false);
  });
});
