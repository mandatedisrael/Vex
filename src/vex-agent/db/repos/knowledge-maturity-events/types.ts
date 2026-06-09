/**
 * knowledge_maturity_events repo — types + row mapper + column list.
 *
 * Append-only audit of every maturity/activation transition on a knowledge entry
 * (S6a). `entry_id` is an IMMUTABLE ANCHOR with NO FK (memory_decisions doctrine):
 * the log is self-contained and survives deletion of its subject. The maturity
 * FSM never deletes a knowledge row, so the anchor is always live at write time.
 *
 * `id` is BIGSERIAL, returned by the pg driver as a string (int8) — kept as
 * `string` in the domain (precision-safe).
 */

import type { MaturityState } from "@vex-agent/memory/schema/long-memory-enums.js";
import type {
  MaturityDecidedBy,
  MaturityEvent,
  MaturityReasonCode,
  MaturityTriggerRefs,
} from "@vex-agent/memory/schema/knowledge-maturity-event.js";

export type {
  MaturityDecidedBy,
  MaturityEvent,
  MaturityReasonCode,
  MaturityTriggerRefs,
} from "@vex-agent/memory/schema/knowledge-maturity-event.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
export interface MaturityEventRow {
  id: string; // pg bigint → string
  entry_id: number;
  event: string;
  from_state: string;
  to_state: string;
  reason_code: string;
  activation_before: number;
  activation_after: number;
  trigger_refs: MaturityTriggerRefs | null;
  decided_by: string;
  rationale: string | null;
  created_at: string;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MaturityEventRecord {
  id: string;
  /** Anchor (no FK): the knowledge_entries.id this transition is about. */
  entryId: number;
  event: MaturityEvent;
  fromState: MaturityState;
  toState: MaturityState;
  reasonCode: MaturityReasonCode;
  activationBefore: number;
  activationAfter: number;
  triggerRefs: MaturityTriggerRefs;
  decidedBy: MaturityDecidedBy;
  rationale: string | null;
  createdAt: string;
}

export function mapRow(r: MaturityEventRow): MaturityEventRecord {
  return {
    id: r.id,
    entryId: r.entry_id,
    event: r.event as MaturityEvent,
    fromState: r.from_state as MaturityState,
    toState: r.to_state as MaturityState,
    reasonCode: r.reason_code as MaturityReasonCode,
    activationBefore: r.activation_before,
    activationAfter: r.activation_after,
    triggerRefs: r.trigger_refs ?? {},
    decidedBy: r.decided_by as MaturityDecidedBy,
    rationale: r.rationale,
    createdAt: r.created_at,
  };
}

// ── Column list (single source of truth for reads) ──────────────
export const MATURITY_EVENT_COLUMNS = `
  id, entry_id, event, from_state, to_state, reason_code,
  activation_before, activation_after, trigger_refs,
  decided_by, rationale, created_at
`;
