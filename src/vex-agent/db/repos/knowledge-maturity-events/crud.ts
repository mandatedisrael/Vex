/**
 * knowledge_maturity_events CRUD — append-only maturity/activation audit (S6a).
 *
 * `recordMaturityEvent` is the ONLY write path. It is append-only (a plain INSERT,
 * no upsert — every transition is a distinct historical fact) and validates the
 * input at this internal boundary (defense-in-depth for the manager's one write
 * path). The repo is allowlisted-memLog only: NO raw content / secrets / monetary
 * values ever reach a log line (only enum/num/id meta — `rationale` is never
 * logged). `entry_id` is a non-FK anchor (memory_decisions doctrine) so the repo
 * owns referential validity — it is only called by the maturity manager holding a
 * live knowledge_entries row.
 *
 * Runs inside the caller's transaction when a `PoolClient` is passed (the
 * reinforcement seam records the event in the SAME tx as the candidate decision;
 * the decay sweep records per-entry on the shared pool).
 */

import type { PoolClient } from "pg";

import { getPool, queryOneWith, queryWith, type Executor } from "../../client.js";
import { jsonb } from "../../params.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  recordMaturityEventInputSchema,
  type RecordMaturityEventInput,
} from "@vex-agent/memory/schema/knowledge-maturity-event.js";
import {
  MATURITY_EVENT_COLUMNS,
  mapRow,
  type MaturityEventRecord,
  type MaturityEventRow,
} from "./types.js";

/**
 * Append one maturity/activation transition. Append-only INSERT; validates the
 * input shape (XOR-free, but the closed enums + activation ranges are enforced at
 * the boundary so a malformed call throws — programmer error — rather than
 * tripping a DB CHECK with a cryptic message). Returns the persisted record.
 */
export async function recordMaturityEvent(
  rawInput: RecordMaturityEventInput,
  client?: PoolClient,
): Promise<MaturityEventRecord> {
  const input = recordMaturityEventInputSchema.parse(rawInput);
  const exec: Executor = client ?? getPool();

  const row = await queryOneWith<MaturityEventRow>(
    exec,
    `INSERT INTO knowledge_maturity_events (
       entry_id, event, from_state, to_state, reason_code,
       activation_before, activation_after, trigger_refs,
       decided_by, rationale
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     RETURNING ${MATURITY_EVENT_COLUMNS}`,
    [
      input.entryId,
      input.event,
      input.fromState,
      input.toState,
      input.reasonCode,
      input.activationBefore,
      input.activationAfter,
      jsonb(input.triggerRefs),
      input.decidedBy,
      input.rationale ?? null,
    ],
  );
  if (!row) {
    throw new Error(
      `recordMaturityEvent: insert returned no row (entry=${input.entryId}, event=${input.event})`,
    );
  }

  // Allowlisted meta only — rationale / trigger payload are NEVER logged.
  memLog("maturity", input.event, {
    entryId: input.entryId,
    maturityEvent: input.event,
    fromState: input.fromState,
    toState: input.toState,
    reasonCode: input.reasonCode,
    activationBefore: input.activationBefore,
    activationAfter: input.activationAfter,
  });

  return mapRow(row);
}

// ── Reads (debug "why" timeline) ─────────────────────────────────

/** Full maturity-event history for one entry, newest first. */
export async function getMaturityEventsForEntry(
  entryId: number,
  client?: PoolClient,
): Promise<MaturityEventRecord[]> {
  if (!Number.isFinite(entryId) || entryId <= 0) return [];
  const exec: Executor = client ?? getPool();
  const rows = await queryWith<MaturityEventRow>(
    exec,
    `SELECT ${MATURITY_EVENT_COLUMNS} FROM knowledge_maturity_events
      WHERE entry_id = $1
      ORDER BY created_at DESC, id DESC`,
    [entryId],
  );
  return rows.map(mapRow);
}
