/**
 * processReconcileJob — outcome reconciliation worker branch (S7 §4).
 *
 * ONE entry per job, single-pass, NO memory_job_items (a reconcile job is keyed
 * (reconcile_entry_id, reconcile_outcome_version) — items are candidate-keyed
 * and structurally do not fit). Job-level heartbeat covers the LLM call;
 * markCompleted / markFailed are the job-level finalizers (markCompleted
 * additionally CONSUMES `wake_pending` into one more pass — D-REARM).
 *
 * Pipeline (D-ORDER — resolve + judge BEFORE the atomic tx):
 *   1. load entry (inactive → no-op) + promoted candidate (none / no stored
 *      outcome → no-op: the entry has no live outcome record, e.g. an import);
 *      validate entry.outcome_version === job.reconcile_outcome_version
 *      (stale → idempotent re-enqueue at the CURRENT version, then no-op —
 *      information never dies, the loop always catches up to the ledger).
 *   2. re-resolve the outcome from the ledger (REUSE S5 resolveOutcome; the
 *      point-in-time flag re-derives from the candidate's PERSISTED as-of
 *      boundary — the boundary is a promote-time fact, not re-computed).
 *   3. `outcomeDelta` — unchanged → complete no-op WITHOUT a decision row
 *      (conscious audit choice: decisions record real changes; a wake at the
 *      same version re-arms the job via D-REARM when the ledger moves again).
 *   4. consequence map (F1, ordered rules) + the LLM re-judge ONLY on a signal
 *      flip or an F2 tier-raise trigger. A judge failure THROWS → markFailed →
 *      the job retries (fail-closed; never a guessed consequence).
 *   5. ONE atomic tx: entry FOR UPDATE FIRST (lock order: entry →
 *      promoted-candidate → job row; disjoint from consolidate's order — no
 *      deadlock cycle, see lockEntryForReconcile) → optimistic version re-check
 *      → tier raise (upward-only, clamped) → consequence (maturity transition +
 *      `outcome_change` audit event / direct invalidate with valid_until) →
 *      candidate outcome rewrite (v+1) → guarded outcome_version bump →
 *      recordDecision('reconcile', decided_by manager|system).
 *
 * Advisory-only (OD-1): every write touches activation / maturity / status /
 * provenance tier ONLY — never sizing, approval, or wallet flows. FIX-3: this
 * is an internal worker function, never a ToolDef.
 *
 * IO is injectable (`ReconcileDeps`) so every branch is unit-testable with
 * stubs (consolidate/decay-sweep precedent).
 */

import type { PoolClient } from "pg";

import { withTransaction } from "@vex-agent/db/client.js";
import {
  findCandidateByPromotedKnowledgeId,
  updateReconciledCandidateOutcome,
  type MemoryCandidate,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import {
  bumpJobInference,
  enqueueReconcileJob,
  heartbeat,
  markCompleted,
  markFailed,
  type MemoryJob,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import { recordDecision } from "@vex-agent/db/repos/memory-decisions/index.js";
import { invalidateEdgesForOrigin } from "@vex-agent/db/repos/memory-edges/index.js";
import {
  applyMaturityTransition,
  bumpOutcomeVersion,
  invalidateEntryOnReconcile,
  lockEntryForReconcile,
  raiseEntrySourceTier,
  type ReconcileEntryLock,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { recordMaturityEvent } from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import { defaultConsolidateDeps } from "@vex-agent/memory/manager/consolidate.js";
import { checkNoLookahead } from "@vex-agent/memory/manager/point-in-time.js";
import {
  deriveEvidenceStrengthCeiling,
} from "@vex-agent/memory/manager/evidence-deref.js";
import {
  nextStateOnDecay,
  nextStateOnReinforce,
  reinforceEventFor,
  reinforcedActivation,
} from "@vex-agent/memory/manager/maturity-policy.js";
import {
  consequenceFor,
  outcomeDelta,
  quenchedActivation,
  resolveFinalAction,
  shouldConsultTierRaise,
  tierRaiseTarget,
  type ReconcileAction,
} from "@vex-agent/memory/manager/reconcile-policy.js";
import {
  callReconcileJudge,
  type ReconcileJudgeContext,
  type ReconcileJudgeResult,
} from "@vex-agent/memory/manager/reconcile-judge.js";
import type { JudgeProvider } from "@vex-agent/memory/manager/judge.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { MaturityTriggerRefs } from "@vex-agent/memory/schema/knowledge-maturity-event.js";
import {
  memoryOutcomeSummarySchema,
  type MemoryOutcomeSummary,
} from "@vex-agent/memory/schema/memory-outcome.js";
import type { CandidateEvidenceStrength } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import {
  MEMORY_RETRY_BACKOFF_BASE_MS,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "./policy.js";

// ── Injectable IO ────────────────────────────────────────────────────

export interface ReconcileDeps {
  /** Pre-tx entry snapshot (status/source/version/FSM) — same shape the tx re-locks. */
  readEntry: (entryId: number) => Promise<ReconcileEntryLock | null>;
  /** The entry's promoted candidate — its LIVE outcome record (S5 doctrine). */
  findCandidateByPromotedKnowledgeId: (
    knowledgeId: number,
  ) => Promise<MemoryCandidate | null>;
  /** S5 resolver reuse — re-derives the outcome from the CURRENT ledger. */
  resolveOutcome: (
    candidate: MemoryCandidate,
    pointInTimeChecked: boolean,
  ) => Promise<MemoryOutcomeSummary | null>;
  /** The LLM re-judge (stubbed in tests). THROWS on any malformed step. */
  judge: (ctx: ReconcileJudgeContext) => Promise<ReconcileJudgeResult>;
  withTransaction: <T>(fn: (tx: PoolClient) => Promise<T>) => Promise<T>;
  lockEntryForReconcile: typeof lockEntryForReconcile;
  applyMaturityTransition: typeof applyMaturityTransition;
  recordMaturityEvent: typeof recordMaturityEvent;
  invalidateEntryOnReconcile: typeof invalidateEntryOnReconcile;
  /** S8 — retract the entry's graph edges when the lesson is invalidated. */
  invalidateEdgesForOrigin: typeof invalidateEdgesForOrigin;
  raiseEntrySourceTier: typeof raiseEntrySourceTier;
  bumpOutcomeVersion: typeof bumpOutcomeVersion;
  updateReconciledCandidateOutcome: typeof updateReconciledCandidateOutcome;
  recordDecision: typeof recordDecision;
  enqueueReconcileJob: typeof enqueueReconcileJob;
  markCompleted: typeof markCompleted;
  markFailed: typeof markFailed;
  heartbeat: typeof heartbeat;
  bumpJobInference: typeof bumpJobInference;
  /** Inference identity recorded on a judge-consulted decision. */
  inferenceProvider: string | null;
  inferenceModel: string | null;
}

/** Production wiring. `makeProvider` is forwarded to the reconcile judge. */
export function defaultReconcileDeps(
  makeProvider?: () => Promise<JudgeProvider>,
): ReconcileDeps {
  // REUSE the S5 production resolver wiring (ledger reads) — defaultConsolidateDeps
  // owns the OutcomeResolverDeps binding; constructing it for the one closure is
  // cheap and keeps ONE source of truth for the ledger-read wiring.
  const { resolveOutcome } = defaultConsolidateDeps();
  return {
    // A short FOR UPDATE-and-commit: the pre-tx snapshot uses the SAME read as
    // the tx re-lock (one row shape, one mapping), released immediately.
    readEntry: (entryId) => withTransaction((tx) => lockEntryForReconcile(entryId, tx)),
    findCandidateByPromotedKnowledgeId: (knowledgeId) =>
      findCandidateByPromotedKnowledgeId(knowledgeId),
    resolveOutcome,
    judge: (ctx) => callReconcileJudge(ctx, makeProvider),
    withTransaction,
    lockEntryForReconcile,
    applyMaturityTransition,
    recordMaturityEvent,
    invalidateEntryOnReconcile,
    invalidateEdgesForOrigin,
    raiseEntrySourceTier,
    bumpOutcomeVersion,
    updateReconciledCandidateOutcome,
    recordDecision,
    enqueueReconcileJob,
    markCompleted,
    markFailed,
    heartbeat,
    bumpJobInference,
    inferenceProvider: "openrouter",
    inferenceModel: process.env.AGENT_MODEL ?? null,
  };
}

// ── No-op vocabulary (§5 — bounded errorCode on `noop`) ─────────────

type ReconcileNoop =
  | "stale_version"
  | "entry_inactive"
  | "no_candidate"
  | "unresolvable"
  | "unchanged";

// ── Tx outcome (discriminated — the post-tx step branches on it) ────

type TxResult =
  | { kind: "applied"; tierRaised: boolean }
  | { kind: "entry_inactive" }
  | { kind: "stale"; currentVersion: number };

// ── processReconcileJob ──────────────────────────────────────────────

/**
 * Process ONE claimed reconcile job end-to-end (claim → resolve → consequence →
 * atomic apply → finalize). Self-finalizing: every path ends in markCompleted
 * (incl. the no-ops) or markFailed (transient error / judge failure → retry).
 * Never throws.
 */
export async function processReconcileJob(
  job: MemoryJob,
  workerId: string,
  deps: ReconcileDeps = defaultReconcileDeps(),
): Promise<void> {
  // Job-level heartbeat (consolidate precedent) — covers the LLM call (§4.6).
  let claimLost = false;
  const heartbeatTimer = setInterval(async () => {
    try {
      const ok = await deps.heartbeat(job.id, workerId);
      if (!ok && !claimLost) {
        claimLost = true;
        memLog.warn("reconcile", "claim_lost", { jobId: job.id });
      }
    } catch {
      // Transient — do NOT flip claim-lost (transient ≠ owner loss).
    }
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  const complete = async (noop?: ReconcileNoop): Promise<void> => {
    if (noop) memLog("reconcile", "noop", { jobId: job.id, errorCode: noop });
    const ok = await deps.markCompleted(job.id, workerId);
    if (ok) memLog("reconcile", "completed", { jobId: job.id });
    else memLog.warn("reconcile", "completion_claim_lost", { jobId: job.id });
  };

  try {
    const entryId = job.reconcileEntryId;
    const jobVersion = job.reconcileOutcomeVersion;
    if (entryId === null || jobVersion === null) {
      // Impossible under mj_reconcile_fields; fail-closed rather than guess.
      throw new Error(`reconcile job ${job.id} missing reconcile fields`);
    }
    memLog("reconcile", "claimed", { jobId: job.id, entryId });

    // ── 1. Entry + candidate + version validation (pre-tx, D-ORDER) ──
    const entry = await deps.readEntry(entryId);
    if (!entry || entry.status !== "active") {
      await complete("entry_inactive");
      return;
    }
    if (entry.outcomeVersion !== jobVersion) {
      // Stale job key — the ledger info is NOT lost: re-enqueue idempotently at
      // the CURRENT version (D-REARM closure), then retire this job.
      await deps.enqueueReconcileJob(entryId, entry.outcomeVersion);
      await complete("stale_version");
      return;
    }

    const candidate = await deps.findCandidateByPromotedKnowledgeId(entryId);
    const oldOutcomeParse =
      candidate?.outcome != null
        ? memoryOutcomeSummarySchema.safeParse(candidate.outcome)
        : null;
    if (!candidate || !oldOutcomeParse || !oldOutcomeParse.success) {
      // No live outcome record behind this entry (import / legacy / non-trade
      // promotion) — nothing to reconcile against.
      await complete("no_candidate");
      return;
    }
    const oldOutcome = oldOutcomeParse.data;

    // ── 2. Re-resolve from the CURRENT ledger (S5 reuse) ─────────────
    // The as-of boundary is a promote-time fact persisted on the candidate
    // (available_at_decision_time) — re-derive only the flag, not the boundary.
    const boundaryMs = candidate.availableAtDecisionTime
      ? Date.parse(candidate.availableAtDecisionTime)
      : Number.NaN;
    const pointInTimeChecked = checkNoLookahead(
      Number.isFinite(boundaryMs) ? new Date(boundaryMs) : null,
    );
    const resolved = await deps.resolveOutcome(candidate, pointInTimeChecked);
    if (!resolved) {
      await complete("unresolvable");
      return;
    }

    // ── 3. Delta — unchanged retires the pass without a decision row ─
    if (outcomeDelta(oldOutcome, resolved) === "unchanged") {
      await complete("unchanged");
      return;
    }

    // ── 4. Consequence map + judge (flip / F2 only) ──────────────────
    const consequence = consequenceFor(oldOutcome, resolved);
    // Ceiling for the F2 trigger + the tier clamp. anchorExists is true by
    // construction (resolveOutcome derefs an anchor execution); recurrence 0 is
    // CONSERVATIVE — it can only lower the non-strong ceiling, i.e. clamp a
    // tier proposal harder, never inflate it.
    const ceiling: CandidateEvidenceStrength = deriveEvidenceStrengthCeiling({
      anchorExists: true,
      recurrenceCount: 0,
      outcome: resolved,
      isTradeKind: true,
    });
    const flip = consequence.kind === "flip_judge";
    const tierRaiseEligible = shouldConsultTierRaise(ceiling, entry.source);

    let judged: ReconcileJudgeResult | null = null;
    if (flip || tierRaiseEligible) {
      try {
        judged = await deps.judge({
          lesson: {
            title: candidate.title,
            summary: candidate.summary,
            kind: candidate.kind,
            sourceTier: entry.source,
          },
          oldOutcome,
          newOutcome: resolved,
          flip,
          tierRaiseEligible,
        });
      } catch (err: unknown) {
        memLog.warn("reconcile", "judge_failed", {
          jobId: job.id,
          errorCode: err instanceof Error ? mapReconcileErrorCode(err) : "judge_unknown",
        });
        throw err; // fail-closed → markFailed → retry
      }
      if (judged.llmCalls > 0) {
        await deps.bumpJobInference(job.id, {
          llmCalls: judged.llmCalls,
          ...(judged.costUsd !== null ? { costUsd: judged.costUsd } : {}),
        });
      }
    }

    const finalAction = resolveFinalAction(consequence, judged?.verdict ?? null);
    // decided_by: `manager` when the LLM judge participated in ANY capacity
    // (flip ruling or F2 tier consult), `system` for the pure deterministic map.
    const decidedBy: "manager" | "system" = judged !== null ? "manager" : "system";

    // The v+1 outcome written to the candidate — re-validated at this boundary
    // (defense-in-depth; the setter relies on a Zod-validated summary).
    const newSummary = memoryOutcomeSummarySchema.parse({
      ...resolved,
      outcomeVersion: jobVersion + 1,
      outcomeLastChangedAt: new Date().toISOString(),
    });

    if (claimLost) return; // do not start the tx on a lost claim

    // ── 5. Atomic apply ──────────────────────────────────────────────
    const txResult = await deps.withTransaction<TxResult>(async (tx) => {
      // Entry FOR UPDATE FIRST (documented lock order — no deadlock cycle).
      const lock = await deps.lockEntryForReconcile(entryId, tx);
      if (!lock || lock.status !== "active") return { kind: "entry_inactive" };
      if (lock.outcomeVersion !== jobVersion) {
        return { kind: "stale", currentVersion: lock.outcomeVersion };
      }

      // F2 tier raise — BEFORE the consequence so it lands on the still-active
      // row (an invalidate later in this tx flips it non-active; raising the
      // provenance of a row this tx retires is then a benign no-op by guard).
      let tierRaised = false;
      if (judged?.verdict.sourceTier !== undefined) {
        const target = tierRaiseTarget(lock.source, judged.verdict.sourceTier, ceiling);
        if (target !== null) {
          tierRaised = await deps.raiseEntrySourceTier(entryId, target, tx);
        }
      }

      await applyConsequence(finalAction, {
        lock,
        candidate,
        rationale: judged?.verdict.rationale ?? null,
        decidedBy,
        tx,
        deps,
      });

      const upd = await deps.updateReconciledCandidateOutcome(
        candidate.id,
        entryId,
        newSummary,
        tx,
      );
      if (!upd.ok) {
        throw new Error(
          `processReconcileJob: updateReconciledCandidateOutcome failed (${upd.reason}) for entry ${entryId}`,
        );
      }

      // Optimistic-concurrency closing write — under the entry lock with the
      // version re-checked above, a miss is an invariant violation, not a race.
      const bumped = await deps.bumpOutcomeVersion(entryId, jobVersion, tx);
      if (!bumped) {
        throw new Error(
          `processReconcileJob: outcome_version bump missed for entry ${entryId} (expected v${jobVersion})`,
        );
      }

      const recorded = await deps.recordDecision(
        {
          decisionType: "reconcile",
          reconcileEntryId: entryId,
          outcomeVersion: jobVersion + 1,
          jobId: job.id,
          decidedBy,
          evidenceRefs: candidate.evidenceRefs,
          ...(judged !== null && deps.inferenceProvider !== null
            ? { inferenceProvider: deps.inferenceProvider }
            : {}),
          ...(judged !== null && deps.inferenceModel !== null
            ? { inferenceModel: deps.inferenceModel }
            : {}),
          ...(judged !== null && judged.costUsd !== null ? { costUsd: judged.costUsd } : {}),
        },
        tx,
      );
      if (!recorded.ok) {
        throw new Error(
          `processReconcileJob: recordDecision failed (${recorded.reason}) for entry ${entryId}`,
        );
      }

      return { kind: "applied", tierRaised };
    });

    // ── 6. Finalize ──────────────────────────────────────────────────
    switch (txResult.kind) {
      case "entry_inactive":
        await complete("entry_inactive");
        return;
      case "stale":
        await deps.enqueueReconcileJob(entryId, txResult.currentVersion);
        await complete("stale_version");
        return;
      case "applied": {
        memLog("reconcile", "consequence_applied", {
          jobId: job.id,
          entryId,
          reconcileAction: finalAction,
          outcomeVersion: jobVersion + 1,
          outcomeStatus: resolved.status,
          lessonSignal: resolved.lessonSignal,
        });
        if (txResult.tierRaised) {
          memLog("reconcile", "consequence_applied", {
            jobId: job.id,
            entryId,
            reconcileAction: "tier_raise",
            outcomeVersion: jobVersion + 1,
          });
        }
        await complete();
        return;
      }
      default: {
        const _exhaustive: never = txResult;
        return _exhaustive;
      }
    }
  } catch (err: unknown) {
    const backoff = MEMORY_RETRY_BACKOFF_BASE_MS * Math.max(1, job.attemptCount);
    const errorCode = err instanceof Error ? mapReconcileErrorCode(err) : "job_unknown";
    await deps.markFailed(job.id, workerId, errorCode, backoff);
    memLog.warn("reconcile", "failed", { jobId: job.id, errorCode });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// ── Consequence application (inside the tx) ─────────────────────────

/**
 * Apply the final action's knowledge-side effect inside the tx. `reinforce` and
 * `quench` are guarded FSM transitions + ONE `outcome_change` audit event
 * (trigger_refs = the candidate's primary anchor executionId); `invalidate` is
 * the direct status+valid_until update (no maturity event — invalidation is a
 * STATUS transition, not an FSM move; the decision row is its audit);
 * `retain`/`bookkeep` change nothing here (version bump + decision only).
 * A precondition miss under the held entry lock is an invariant violation
 * (nothing can interleave past FOR UPDATE) → THROW → rollback → retry.
 */
async function applyConsequence(
  action: ReconcileAction,
  args: {
    lock: ReconcileEntryLock;
    candidate: MemoryCandidate;
    rationale: string | null;
    decidedBy: "manager" | "system";
    tx: PoolClient;
    deps: ReconcileDeps;
  },
): Promise<void> {
  const { lock, tx, deps } = args;
  const primaryExecutionId = args.candidate.evidenceRefs[0]?.executionId;
  const triggerRefs: MaturityTriggerRefs =
    primaryExecutionId !== undefined ? { executionId: primaryExecutionId } : {};

  switch (action) {
    case "reinforce": {
      const toState = nextStateOnReinforce(lock.maturityState);
      const activationAfter = reinforcedActivation(lock.activationStrength, lock.maturityState);
      const ok = await deps.applyMaturityTransition(
        {
          entryId: lock.id,
          expectedMaturityState: lock.maturityState,
          expectedActivation: lock.activationStrength,
          nextMaturityState: toState,
          nextActivation: activationAfter,
          bumpLastReinforcedAt: true,
          bumpLastDecayedAt: false,
        },
        tx,
      );
      if (!ok) throw new Error(`reconcile reinforce: precondition miss under lock (entry ${lock.id})`);
      await deps.recordMaturityEvent(
        {
          entryId: lock.id,
          event: reinforceEventFor(lock.maturityState, toState),
          fromState: lock.maturityState,
          toState,
          reasonCode: "outcome_change",
          activationBefore: lock.activationStrength,
          activationAfter,
          triggerRefs,
          decidedBy: args.decidedBy,
        },
        tx,
      );
      return;
    }
    case "quench": {
      const activationAfter = quenchedActivation(lock.activationStrength);
      const toState = nextStateOnDecay(lock.maturityState, activationAfter);
      const ok = await deps.applyMaturityTransition(
        {
          entryId: lock.id,
          expectedMaturityState: lock.maturityState,
          expectedActivation: lock.activationStrength,
          nextMaturityState: toState,
          nextActivation: activationAfter,
          bumpLastReinforcedAt: false,
          // S6b incremental anchor: a quench IS an applied decay step — the
          // next sweep erodes only the quantum after it (never re-compounds).
          bumpLastDecayedAt: true,
        },
        tx,
      );
      if (!ok) throw new Error(`reconcile quench: precondition miss under lock (entry ${lock.id})`);
      await deps.recordMaturityEvent(
        {
          entryId: lock.id,
          event: "decayed",
          fromState: lock.maturityState,
          toState,
          reasonCode: "outcome_change",
          activationBefore: lock.activationStrength,
          activationAfter,
          triggerRefs,
          decidedBy: args.decidedBy,
        },
        tx,
      );
      return;
    }
    case "invalidate": {
      const ok = await deps.invalidateEntryOnReconcile(lock.id, args.rationale, tx);
      if (!ok) throw new Error(`reconcile invalidate: update missed under lock (entry ${lock.id})`);
      // S8 (D-SUPERSEDE-WIRING): the lesson's graph edges are ITS claims — when
      // the lesson dies, retract them in the SAME tx (bulk, idempotent; count
      // logged by the repo). Deliberately NO savepoint here: this is one plain
      // UPDATE, and a statement failure means the tx/connection is already
      // doomed — the job's markFailed→retry path is the recovery, exactly as
      // for every other reconcile write. Entry↔entity links stay (historical;
      // expansion filters on ke.status='active').
      await deps.invalidateEdgesForOrigin(lock.id, tx);
      return;
    }
    case "retain":
    case "bookkeep":
      // Version bump + candidate outcome + decision only — zero knowledge-side
      // state change (conservative default / judge-examined keep).
      return;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ── Error-code mapping (bounded; never a raw message) ───────────────

function mapReconcileErrorCode(err: Error): string {
  const msg = err.message;
  if (msg.includes("timeout")) return "judge_timeout";
  if (msg.includes("malformed")) return "judge_malformed";
  if (msg.includes("schema_invalid")) return "judge_schema_invalid";
  if (msg.includes("config")) return "provider_config";
  return "job_error";
}
