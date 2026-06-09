/**
 * Activation decay sweep (S6a) — the periodic batch that erodes
 * `activation_strength` on decayable knowledge entries (D-DECAY). Runs off the
 * memory_manager maintenance cron-tick (alongside the consolidate-enqueue sweep).
 *
 * For each active, non-`none`-policy entry it applies ONE `decayEntry` step
 * (exp half-life, floored > 0, never deletes; audited only when the change is
 * significant — anti audit-spam). The sweep is:
 *   - IDEMPOTENT: re-running the same day produces a sub-`DECAY_AUDIT_MIN_DELTA`
 *     change → `decayEntry` no-ops (no write, no audit).
 *   - RESUMABLE / BOUNDED: pages through entries by id in batches and caps the
 *     total entries touched per run (`DECAY_SWEEP_MAX_ENTRIES`) so one tick cannot
 *     scan an unbounded table.
 *   - NON-FATAL per entry: a single entry's failure is logged and skipped; the
 *     sweep continues (one bad row never aborts the batch).
 *
 * IO is injectable so the loop is unit-testable without a DB; the production
 * wiring binds `listDecayableEntries` + `decayEntry`.
 */

import {
  listDecayableEntries,
  type MaturityEntryRow,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { decayEntry, type DecayResult } from "@vex-agent/memory/manager/maturity.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";

// ── Cadence / batch sizing (tune empirically, do not freeze) ────────

/** Entries fetched per page in one sweep run. */
export const DECAY_SWEEP_BATCH_SIZE = 200;

/**
 * Hard cap on entries TOUCHED in one sweep run, so a single maintenance tick can
 * never scan an unbounded table. The remainder is picked up on the next tick
 * (the scan resumes from id 0 each run; decay is idempotent so re-visiting an
 * already-decayed-today row is a cheap no-op).
 */
export const DECAY_SWEEP_MAX_ENTRIES = 2_000;

// ── Injectable IO ────────────────────────────────────────────────────

export interface DecaySweepDeps {
  listDecayableEntries: (args: { afterId: number; limit: number }) => Promise<MaturityEntryRow[]>;
  decayEntry: (entry: MaturityEntryRow, now: Date) => Promise<DecayResult>;
}

export function defaultDecaySweepDeps(): DecaySweepDeps {
  return {
    listDecayableEntries: (args) => listDecayableEntries(args),
    decayEntry: (entry, now) => decayEntry(entry, now),
  };
}

export interface DecaySweepResult {
  /** Entries scanned (read). */
  scanned: number;
  /** Entries whose activation/tier actually changed (written + audited). */
  decayed: number;
  /** Entries that errored and were skipped (sweep continued). */
  errored: number;
}

/**
 * Run one decay sweep pass. Pages decayable entries by id, applies one
 * `decayEntry` step each (each does its OWN guarded transaction), and returns the
 * aggregate counts. `now` is injectable for deterministic tests.
 */
export async function runDecaySweep(
  now: Date = new Date(),
  deps: DecaySweepDeps = defaultDecaySweepDeps(),
): Promise<DecaySweepResult> {
  let afterId = 0;
  let scanned = 0;
  let decayed = 0;
  let errored = 0;

  while (scanned < DECAY_SWEEP_MAX_ENTRIES) {
    const remaining = DECAY_SWEEP_MAX_ENTRIES - scanned;
    const limit = Math.min(DECAY_SWEEP_BATCH_SIZE, remaining);
    const batch = await deps.listDecayableEntries({ afterId, limit });
    if (batch.length === 0) break;

    for (const entry of batch) {
      scanned += 1;
      afterId = entry.id;
      try {
        const result = await deps.decayEntry(entry, now);
        if (result.ok && result.applied) decayed += 1;
      } catch {
        // Non-fatal: one bad row never aborts the sweep.
        errored += 1;
        memLog.warn("decay_sweep", "entry_failed", { entryId: entry.id });
      }
    }

    if (batch.length < limit) break; // last page
  }

  memLog("decay_sweep", "completed", { count: decayed, queueDepth: scanned });
  if (errored > 0) memLog.warn("decay_sweep", "errors", { count: errored });

  return { scanned, decayed, errored };
}
