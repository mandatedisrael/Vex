/**
 * Ledger→memory wake seam (S7 §3 / D-SEAM). When the ledger records new trade
 * facts (an agent trade OR a settlement-sync synthetic capture), this maps the
 * FIX-1 anchor keys of the just-recorded capture items to the ACTIVE knowledge
 * entries whose promoted candidates anchor them, and enqueues ONE reconcile job
 * per entry keyed by its CURRENT `outcome_version` (D-KEY/D-REARM — the repo's
 * conflict handling re-arms/flags/no-ops as appropriate).
 *
 * Called from EXACTLY ONE place: the end of `populateCaptureItems`
 * (tools/protocols/capture-pipeline.ts). That single seam covers agent trades
 * AND settlement sync (`recordSyntheticCapture` → `populateCaptureItems`),
 * while `replayActivityFromCapture` structurally bypasses it — a projection
 * replay can never storm the reconcile queue. Best-effort by contract: the
 * caller wraps this in try/catch; the LEDGER is the source of truth and memory
 * catches up (a missed wake is repaired by the next wake on the same keys —
 * a false-positive wake is a cheap reconcile no-op).
 *
 * Matching is by JSONB containment on `memory_candidates.evidence_refs`
 * (camelCase anchor keys per `evidenceAnchorSchema`): a settlement that closes
 * a position carries a NEW executionId, so the semantic keys
 * (positionKey / instrumentKey) are what find the original lesson — exactly
 * why FIX-1 keeps them on the anchor. The OR-ed `@>` probes resolve on the
 * `idx_mc_evidence_refs` GIN via BitmapOr (D-MAP).
 *
 * Advisory-only (OD-1): this module touches ONLY the memory substrate
 * (memory_jobs). It never reads or writes sizing/approval/wallet state.
 */

import {
  findPromotedWakeTargets,
  type WakeAnchorProbe,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { enqueueReconcileJob } from "@vex-agent/db/repos/memory-jobs/index.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";

// ── Input keys (one per capture item) ───────────────────────────────

/**
 * The anchor keys ONE capture item contributes to the wake: the immutable
 * `executionId` plus the semantic keys when the capture carried them. Shape
 * mirrors `evidenceAnchorSchema` minus `captureItemId` (a wake matches by
 * execution/semantic identity, never by capture-item id).
 */
export interface LedgerWakeKey {
  executionId: number;
  instrumentKey?: string;
  positionKey?: string;
}

export interface LedgerWakeResult {
  /** Distinct ACTIVE knowledge entries whose promoted candidates matched a probe. */
  matchedEntries: number;
  /** Reconcile jobs FRESHLY inserted by this wake (re-arms / already-queued rows are matched, not counted here). */
  enqueued: number;
}

// ── Injectable IO ────────────────────────────────────────────────────

export interface LedgerWakeDeps {
  findPromotedWakeTargets: typeof findPromotedWakeTargets;
  enqueueReconcileJob: typeof enqueueReconcileJob;
}

export function defaultLedgerWakeDeps(): LedgerWakeDeps {
  return { findPromotedWakeTargets, enqueueReconcileJob };
}

// ── Probe construction (dedupe per key field) ───────────────────────

/**
 * Build the deduped single-field containment probes from the wake keys. Each
 * DISTINCT executionId / instrumentKey / positionKey becomes ONE probe (a
 * capture batch often repeats the same instrument across items — N items must
 * not produce N identical probes). Invalid values (non-positive/non-finite
 * ids, empty strings) are skipped — fail-closed, never a malformed probe.
 */
export function buildWakeProbes(keys: ReadonlyArray<LedgerWakeKey>): WakeAnchorProbe[] {
  const executionIds = new Set<number>();
  const instrumentKeys = new Set<string>();
  const positionKeys = new Set<string>();

  for (const key of keys) {
    if (Number.isFinite(key.executionId) && key.executionId > 0) {
      executionIds.add(key.executionId);
    }
    if (typeof key.instrumentKey === "string" && key.instrumentKey.length > 0) {
      instrumentKeys.add(key.instrumentKey);
    }
    if (typeof key.positionKey === "string" && key.positionKey.length > 0) {
      positionKeys.add(key.positionKey);
    }
  }

  return [
    ...[...executionIds].map((executionId): WakeAnchorProbe => ({ executionId })),
    ...[...instrumentKeys].map((instrumentKey): WakeAnchorProbe => ({ instrumentKey })),
    ...[...positionKeys].map((positionKey): WakeAnchorProbe => ({ positionKey })),
  ];
}

// ── Wake ─────────────────────────────────────────────────────────────

/**
 * Map the wake keys to active promoted lessons and enqueue one reconcile job
 * per (entry, CURRENT outcome_version). Errors propagate to the caller (the
 * single call site catches and logs — sync must never break over memory).
 */
export async function enqueueLedgerWake(
  keys: ReadonlyArray<LedgerWakeKey>,
  deps: LedgerWakeDeps = defaultLedgerWakeDeps(),
): Promise<LedgerWakeResult> {
  const probes = buildWakeProbes(keys);
  if (probes.length === 0) return { matchedEntries: 0, enqueued: 0 };

  const targets = await deps.findPromotedWakeTargets(probes);
  let enqueued = 0;
  for (const target of targets) {
    const { inserted } = await deps.enqueueReconcileJob(target.entryId, target.outcomeVersion);
    if (inserted) enqueued += 1;
  }

  // Log only when something matched — every trade passes through here and a
  // zero-match wake is the common case, not a signal.
  if (targets.length > 0) {
    memLog("reconcile", "wake_enqueued", {
      matchedEntries: targets.length,
      enqueuedJobs: enqueued,
    });
  }
  return { matchedEntries: targets.length, enqueued };
}
