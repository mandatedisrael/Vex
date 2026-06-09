/**
 * Per-candidate consolidation orchestration (S4 §5 step 3 / §6–§9). For ONE
 * reserved candidate this:
 *   1. derefs evidence anchors (existence + OD-3 soft-delete + recurrence) and
 *      runs the deterministic stage (D1–D11) using the candidate's embedding to
 *      pull near-dup/conflict matches from active knowledge.
 *   2. on a deterministic terminal → that plan; on escalate → calls the judge
 *      and maps the verdict to a plan (the judge owns every promotion).
 *   3. applies the plan ATOMICALLY: ONE transaction does the owner-check
 *      (claim-lost → throw BEFORE any knowledge write), applyDecision, and
 *      recordDecision; the item is closed (markItemDone) AFTER commit.
 *
 * Idempotent-close (R2#2): a candidate that is already non-pending (its decision
 * committed on a prior attempt but markItemDone failed) is NOT re-judged — the
 * caller looks up the latest decision and closes the item with it (no double
 * promote). That path lives in the executor; this module owns the decision +
 * atomic apply for a PENDING candidate.
 *
 * IO is injectable (`ConsolidateDeps`) so the decision pipeline is unit-testable
 * with stubbed recall / deref / judge.
 */

import type { PoolClient } from "pg";

import { withTransaction, queryOneWith } from "@vex-agent/db/client.js";
import {
  getCandidateById,
  getCandidateEmbedding,
  type MemoryCandidate,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { recordDecision } from "@vex-agent/db/repos/memory-decisions/index.js";
import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge/recall.js";
import {
  recallCandidatesTopK,
  updateCandidateOutcome,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import * as executionsRepo from "@vex-agent/db/repos/executions.js";
import * as activityRepo from "@vex-agent/db/repos/activity.js";
import * as pnlMatchesRepo from "@vex-agent/db/repos/pnl-matches.js";
import * as pnlLotsRepo from "@vex-agent/db/repos/pnl-lots.js";
import * as openPositionsRepo from "@vex-agent/db/repos/open-positions.js";
import * as lpEventsRepo from "@vex-agent/db/repos/lp-events.js";
import { isSessionSoftDeleted } from "@vex-agent/db/repos/sessions.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { scanLiveState } from "@vex-agent/memory/exclusion-rules.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import type { CandidateEvidenceStrength } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import {
  LIVE_STATE_RESCAN_REJECT_FRACTION,
  RECURRENCE_CLUSTER_COSINE,
} from "@vex-agent/engine/memory-manager/policy.js";

import {
  runDeterministicStage,
  type DeterministicVerdict,
  type EscalationSignals,
  type KnowledgeMatch,
} from "./deterministic-stage.js";
import {
  derefAnchorExistence,
  countRecurrence,
  deriveEvidenceStrengthCeiling,
} from "./evidence-deref.js";
import { resolveOutcome, type OutcomeResolverDeps } from "./outcome-resolver.js";
import {
  deriveDecisionBoundary,
  checkNoLookahead,
  type ExecTimeDeref,
} from "./point-in-time.js";
import { isTradeKind } from "./kind-families.js";
import { buildJudgeContext } from "./context-builder.js";
import { callJudge, type JudgeProvider } from "./judge.js";
import type { JudgeVerdict } from "./judge-schema.js";
import { applyDecision, type DecisionPlan } from "./promote.js";
import { reinforceEntry, defaultMaturityDeps, type MaturityDeps } from "./maturity.js";
import { findActiveByContentHash } from "@vex-agent/db/repos/knowledge/crud.js";

// ── Injectable IO ───────────────────────────────────────────────────

export interface ConsolidateDeps {
  /** Top-K active knowledge near-dup/conflict matches for the candidate vector. */
  recallKnowledge: (
    embedding: readonly number[],
    model: string,
    dim: number,
    k: number,
  ) => Promise<KnowledgeMatch[]>;
  /** Cluster anchors: evidence refs of similar pending/retained candidates. */
  recallClusterAnchors: (
    embedding: readonly number[],
    model: string,
    dim: number,
    k: number,
  ) => Promise<EvidenceRefs[]>;
  /** Exact content-hash duplicate present in knowledge_entries. */
  exactDuplicateExists: (contentHash: string) => Promise<boolean>;
  /** Execution anchor → its session (or null if the execution no longer exists). */
  getExecutionSession: (executionId: number) => Promise<{ sessionId: string | null } | null>;
  /** OD-3 — session soft-deleted. */
  isSessionSoftDeleted: (sessionId: string) => Promise<boolean>;
  /** The LLM judge (stubbed in tests). */
  judge: (
    candidate: MemoryCandidate,
    signals: EscalationSignals,
  ) => Promise<{ verdict: JudgeVerdict; llmCalls: number; costUsd: number | null }>;
  /**
   * S5 — resolve the ledger-grounded outcome for a trade-family candidate. The
   * resolver derefs the immutable `executionId` anchor and reads the local
   * ledger (D-OUTCOME-SRC); `pointInTimeChecked` is computed here and passed in.
   * Injected so the decision pipeline is testable without the ledger repos.
   */
  resolveOutcome: (
    candidate: MemoryCandidate,
    pointInTimeChecked: boolean,
  ) => Promise<MemoryOutcomeSummary | null>;
  /** S5 — an anchor execution's created_at (drives the as-of decision boundary). */
  getExecutionTime: ExecTimeDeref;
  /** Inference identity recorded on a decision. */
  inferenceProvider: string | null;
  inferenceModel: string | null;
}

// ── Default deps (production wiring) ────────────────────────────────

const NEAR_DUP_K = 8;
const CLUSTER_K = 16;

export function defaultConsolidateDeps(
  makeProvider?: () => Promise<JudgeProvider>,
): ConsolidateDeps {
  return {
    recallKnowledge: async (embedding, model, dim, k) => {
      const rows = await recallLongMemoryTopK(embedding, {
        embeddingModel: model,
        embeddingDim: dim,
        includeExpired: false,
      }, k);
      return rows
        .filter((r) => r.status === "active")
        .map((r) => ({
          knowledgeId: r.id,
          kind: r.kind,
          similarity: r.similarity,
          text: `${r.title}\n${r.summary}`,
        }));
    },
    recallClusterAnchors: async (embedding, model, dim, k) => {
      const rows = await recallCandidatesTopK(
        embedding,
        { embeddingModel: model, embeddingDim: dim },
        k,
      );
      return rows
        .filter((r) => r.similarity >= RECURRENCE_CLUSTER_COSINE)
        .map((r) => r.evidenceRefs);
    },
    exactDuplicateExists: async (contentHash) => {
      const existing = await knowledgeRepo.findByContentHash(contentHash);
      return existing !== null;
    },
    getExecutionSession: async (executionId) => {
      const exec = await executionsRepo.getById(executionId);
      return exec ? { sessionId: exec.sessionId } : null;
    },
    isSessionSoftDeleted,
    judge: async (candidate, signals) => {
      const ctx = await buildJudgeContext(candidate, signals);
      return callJudge(ctx, makeProvider);
    },
    resolveOutcome: (candidate, pointInTimeChecked) =>
      resolveOutcome(candidate, pointInTimeChecked, LEDGER_OUTCOME_DEPS),
    getExecutionTime: async (executionId) => {
      const exec = await executionsRepo.getById(executionId);
      return exec ? { createdAt: exec.createdAt } : null;
    },
    inferenceProvider: "openrouter",
    inferenceModel: process.env.AGENT_MODEL ?? null,
  };
}

/** Production ledger reads for the S5 outcome resolver (read-only). */
const LEDGER_OUTCOME_DEPS: OutcomeResolverDeps = {
  getExecutionById: (executionId) => executionsRepo.getById(executionId),
  getActivitiesByExecution: (executionId) => activityRepo.getByExecution(executionId),
  getMatchesBySell: (sellActivityId) => pnlMatchesRepo.getMatchesBySell(sellActivityId),
  getOpenLots: (instrumentKey, walletAddress) => pnlLotsRepo.getOpenLots(instrumentKey, walletAddress),
  getPositionByKey: (positionKey) => openPositionsRepo.getByPositionKeyAnyStatus(positionKey),
  getLpEventsByPosition: (positionKey) => lpEventsRepo.getLpEventsByPosition(positionKey),
};

// ── Verdict → plan mapping ──────────────────────────────────────────

/**
 * Hard cap the judge's provenance tier by the deterministic grounding ceiling
 * (§6 / D-GROUND): the LLM may NEVER claim a stronger `source` than the evidence
 * supports — promptly-instructed calibration is NOT runtime-safe on its own
 * (memory-poisoning threat model). `user_confirmed` is EXEMPT: it is grounded by
 * an explicit user affirmation in the transcript (the human is the verifier), not
 * by an execution anchor, so the evidence-strength ceiling does not apply to it.
 *
 *   ceiling 'none'     → max 'hypothesis'
 *   ceiling 'weak'     → max 'inferred'
 *   ceiling 'moderate' → max 'observed'   (S4 never derives 'strong'; → 'observed')
 *
 * The clamp only LOWERS — a judge tier already at/under the cap is unchanged.
 */
const EVIDENCE_SOURCE_RANK: Record<Exclude<KnowledgeSource, "user_confirmed">, number> = {
  hypothesis: 0,
  inferred: 1,
  observed: 2,
};

function maxTierForCeiling(
  ceiling: CandidateEvidenceStrength,
): Exclude<KnowledgeSource, "user_confirmed"> {
  switch (ceiling) {
    case "none":
      return "hypothesis";
    case "weak":
      return "inferred";
    case "moderate":
    case "strong":
      return "observed";
    default: {
      const _exhaustive: never = ceiling;
      return _exhaustive;
    }
  }
}

export function clampSourceTier(
  tier: KnowledgeSource,
  ceiling: CandidateEvidenceStrength,
): KnowledgeSource {
  if (tier === "user_confirmed") return "user_confirmed"; // D-GROUND: human is the verifier.
  const cap = maxTierForCeiling(ceiling);
  return EVIDENCE_SOURCE_RANK[tier] <= EVIDENCE_SOURCE_RANK[cap] ? tier : cap;
}

/**
 * Map a judge verdict + the deterministic conflict target onto a `DecisionPlan`.
 * A `supersede` verdict REQUIRES a conflict target — the judge's
 * `previousKnowledgeId` (schema-required) is preferred, falling back to the
 * deterministic conflict id; if neither is present the supersede is downgraded to
 * a retain (never a blind supersede of an unknown predecessor). The judge's
 * `sourceTier` is HARD-CLAMPED to the grounding ceiling before it reaches the plan.
 */
function planFromVerdict(
  verdict: JudgeVerdict,
  conflictKnowledgeId: number | null,
  evidenceStrengthCeiling: CandidateEvidenceStrength,
  inference: { provider: string | null; model: string | null; costUsd: number | null },
): DecisionPlan {
  const inf = {
    inferenceProvider: inference.provider,
    inferenceModel: inference.model,
    costUsd: inference.costUsd,
  };
  const sourceTier = clampSourceTier(verdict.sourceTier, evidenceStrengthCeiling);
  switch (verdict.verdict) {
    case "promote":
      return {
        type: "promote",
        sourceTier,
        regimeTags: verdict.regimeTags,
        ...inf,
      };
    case "supersede": {
      const previousKnowledgeId = verdict.previousKnowledgeId ?? conflictKnowledgeId;
      if (previousKnowledgeId === null || previousKnowledgeId === undefined) {
        return { type: "retain", ...inf };
      }
      return {
        type: "supersede",
        previousKnowledgeId,
        sourceTier,
        regimeTags: verdict.regimeTags,
        ...inf,
      };
    }
    case "retain":
      return { type: "retain", ...inf };
    case "reject":
      return { type: "reject", reason: verdict.rejectReason ?? "insufficient_evidence" };
    case "expire":
      return { type: "expire", reason: verdict.rejectReason ?? "expired_ttl" };
    default: {
      const _exhaustive: never = verdict.verdict;
      return _exhaustive;
    }
  }
}

function planFromDeterministic(v: Extract<DeterministicVerdict, { kind: "reject" | "expire" | "retain" }>): DecisionPlan {
  if (v.kind === "retain") return { type: "retain" };
  if (v.kind === "reject") return { type: "reject", reason: v.reason };
  return { type: "expire", reason: v.reason };
}

// ── consolidateCandidate (deterministic + judge → plan) ─────────────

/**
 * S6a reinforcement seam: a candidate that is a duplicate of an ACTIVE knowledge
 * entry is a 2nd confirmation → reinforce that entry (recurrence; D-MATURE)
 * instead of dropping the candidate silently. The target is resolved in the
 * atomic apply tx (so the read + reinforce + decision are atomic):
 *   - `{ kind: "entry"; knowledgeId }` — D5 near-dup carried the matched id.
 *   - `{ kind: "contentHash"; contentHash }` — D4 exact-dup; the active entry is
 *     looked up by content-hash in the tx (`findActiveByContentHash`).
 * Absent on every non-duplicate decision.
 */
export type ReinforcementTarget =
  | { kind: "entry"; knowledgeId: number }
  | { kind: "contentHash"; contentHash: string };

export interface CandidateDecision {
  plan: DecisionPlan;
  llmCalls: number;
  costUsd: number | null;
  /**
   * S5 — the ledger-grounded outcome for a trade-family candidate (null for
   * non-trade kinds or when no anchor survives). Carried to the atomic apply so
   * `updateCandidateOutcome` writes it in the SAME tx as the decision (D-ORDER /
   * §8). Non-trade kinds leave this null and S5 does not touch them.
   */
  outcome: MemoryOutcomeSummary | null;
  /** S5 — the as-of decision boundary stamped on `available_at_decision_time`. */
  availableAtDecisionTime: Date | null;
  /**
   * S6a — when the decision is a `duplicate` reject of an active entry, the
   * reinforcement target. The atomic apply reinforces it (2nd confirmation) in the
   * SAME tx as the decision. Null for every non-reinforcing decision.
   */
  reinforce: ReinforcementTarget | null;
}

/**
 * Decide ONE pending candidate: deref evidence, run the deterministic stage, and
 * (on escalate) the judge. Returns the resolved plan + LLM telemetry. Does NOT
 * write anything — the atomic apply is a separate step (`applyDecisionAtomically`)
 * so the owner-check + write happen in one transaction.
 */
export async function consolidateCandidate(
  candidate: MemoryCandidate,
  embedding: { embedding: number[]; embeddingModel: string; embeddingDim: number },
  deps: ConsolidateDeps,
): Promise<CandidateDecision> {
  // Live-state re-scan (D1) on the redacted aggregate (incl. entities/tags).
  const aggregate = [
    candidate.title,
    candidate.summary,
    candidate.contentMd,
    ...candidate.entities,
    ...candidate.tags,
  ].join("\n");
  const liveStateRejected =
    scanLiveState(aggregate).liveFraction >= LIVE_STATE_RESCAN_REJECT_FRACTION;

  // Evidence deref (D2/D3 + recurrence D7).
  const anchorRes = await derefAnchorExistence(candidate.evidenceRefs, {
    getExecutionSession: deps.getExecutionSession,
    isSessionSoftDeleted: deps.isSessionSoftDeleted,
  });

  const clusterAnchors = await deps.recallClusterAnchors(
    embedding.embedding,
    embedding.embeddingModel,
    embedding.embeddingDim,
    CLUSTER_K,
  );
  const recurrenceCount = countRecurrence(candidate.evidenceRefs, clusterAnchors);

  // ── S5: outcome resolution BEFORE the deterministic stage / judge (D-ORDER) ──
  // For trade-family candidates ONLY, deref the immutable anchor → ledger facts
  // and the no-lookahead boundary, so `deriveEvidenceStrengthCeiling` is
  // outcome-aware (can reach 'strong') before `clampSourceTier` runs. Non-trade
  // kinds skip the resolver entirely (S5 leaves them at the S4 ceiling).
  const tradeFamily = isTradeKind(candidate.kind);
  let outcome: MemoryOutcomeSummary | null = null;
  let availableAtDecisionTime: Date | null = null;
  if (tradeFamily) {
    availableAtDecisionTime = await deriveDecisionBoundary(candidate, {
      getExecutionTime: deps.getExecutionTime,
    });
    const pointInTimeChecked = checkNoLookahead(availableAtDecisionTime);
    outcome = await deps.resolveOutcome(candidate, pointInTimeChecked);
    if (outcome) {
      memLog("manager", "outcome_resolved", {
        candidateId: candidate.id,
        outcomeStatus: outcome.status,
        lessonSignal: outcome.lessonSignal,
        evidenceQuality: outcome.evidenceQuality,
        pointInTimeChecked: outcome.pointInTimeChecked ? "true" : "false",
      });
    } else {
      memLog("manager", "outcome_no_anchor", { candidateId: candidate.id });
    }
  }

  const evidenceStrengthCeiling = deriveEvidenceStrengthCeiling({
    anchorExists: anchorRes.anchorExists,
    recurrenceCount,
    outcome,
    isTradeKind: tradeFamily,
  });

  // Near-dup / conflict / exact-dup signals (D4/D5/D6).
  const contentHash = computeContentHash({
    kind: candidate.kind,
    title: candidate.title,
    summary: candidate.summary,
    contentMd: candidate.contentMd,
  });
  const exactDuplicate = await deps.exactDuplicateExists(contentHash);
  const knowledgeMatches = await deps.recallKnowledge(
    embedding.embedding,
    embedding.embeddingModel,
    embedding.embeddingDim,
    NEAR_DUP_K,
  );

  const verdict = runDeterministicStage({
    candidate,
    liveStateRejected,
    evidenceSoftDeleted: anchorRes.softDeleted,
    anchorExists: anchorRes.anchorExists,
    evidenceStrengthCeiling,
    exactDuplicate,
    knowledgeMatches,
    recurrenceCount,
    isUserAffirmed: false, // refined by the transcript in the judge context
  });

  if (verdict.kind !== "escalate") {
    // S6a reinforcement seam: a `duplicate` reject means the candidate confirms an
    // existing ACTIVE entry (a 2nd confirmation; D-MATURE). Resolve the target so
    // the atomic apply can reinforce it — D5 near-dup carried the matched id; D4
    // exact-dup resolves the active entry by content-hash in the tx.
    const reinforce = reinforcementTargetFor(verdict, exactDuplicate, contentHash);
    return {
      plan: planFromDeterministic(verdict),
      llmCalls: 0,
      costUsd: null,
      outcome,
      availableAtDecisionTime,
      reinforce,
    };
  }

  // Escalate → the judge owns the promotion decision.
  const judged = await deps.judge(candidate, verdict.signals);
  const plan = planFromVerdict(
    judged.verdict,
    verdict.signals.conflictKnowledgeId,
    verdict.signals.evidenceStrengthCeiling,
    {
      provider: deps.inferenceProvider,
      model: deps.inferenceModel,
      costUsd: judged.costUsd,
    },
  );
  return {
    plan,
    llmCalls: judged.llmCalls,
    costUsd: judged.costUsd,
    outcome,
    availableAtDecisionTime,
    // The judge path never produces a deterministic `duplicate` — escalation
    // means D4/D5 did NOT fire, so there is no reinforcement target here.
    reinforce: null,
  };
}

/**
 * Resolve the S6a reinforcement target from a deterministic verdict (§8). A
 * `duplicate` reject is a 2nd confirmation of an existing ACTIVE entry:
 *   - D5 near-dup carried the matched id → reinforce that entry directly.
 *   - D4 exact content-hash dup (`exactDuplicate`) → reinforce the active entry
 *     that owns this content-hash (resolved in the tx by `findActiveByContentHash`).
 * Every non-duplicate verdict (and a non-reject) yields null.
 */
function reinforcementTargetFor(
  verdict: DeterministicVerdict,
  exactDuplicate: boolean,
  contentHash: string,
): ReinforcementTarget | null {
  if (verdict.kind !== "reject" || verdict.reason !== "duplicate") return null;
  if (verdict.reinforcesKnowledgeId !== undefined) {
    return { kind: "entry", knowledgeId: verdict.reinforcesKnowledgeId };
  }
  if (exactDuplicate) return { kind: "contentHash", contentHash };
  return null;
}

// ── applyDecisionAtomically (owner-check + apply + record, one tx) ──

export interface AtomicApplyResult {
  decisionId: string;
  decisionType: DecisionPlan["type"];
}

/**
 * Owner-check (R1#2) + S5 outcome write + applyDecision + recordDecision in ONE
 * transaction (FIX-4 §8 / S5 §8). The owner-check `SELECT … FOR UPDATE OF i,j`
 * proves this worker still holds the item BEFORE any write; a lost claim THROWS
 * before any mutation. When the candidate is trade-family with a resolved
 * outcome, `updateCandidateOutcome` persists the ledger facts + as-of boundary
 * BEFORE promote (so the lesson is grounded), and the boundary becomes the
 * promoted entry's `valid_from` with an explicit `outcome_version=0` (S5 init;
 * S7 bumps). recordDecision re-locks the same rows in the SAME tx (no deadlock).
 * The item is closed (markItemDone) by the caller AFTER commit.
 */
export async function applyDecisionAtomically(args: {
  candidate: MemoryCandidate;
  plan: DecisionPlan;
  jobId: number;
  workerId: string;
  /** S5 — ledger-grounded outcome (null for non-trade kinds / no surviving anchor). */
  outcome?: MemoryOutcomeSummary | null;
  /** S5 — as-of decision boundary → candidate.available_at_decision_time + valid_from. */
  availableAtDecisionTime?: Date | null;
  /** S6a — reinforce the active entry this duplicate confirms (2nd confirmation). */
  reinforce?: ReinforcementTarget | null;
  /** S6a — injectable maturity IO (tests stub the reinforce path). */
  maturityDeps?: MaturityDeps;
  client?: PoolClient;
}): Promise<AtomicApplyResult> {
  const outcome = args.outcome ?? null;
  const boundary = args.availableAtDecisionTime ?? null;
  const reinforce = args.reinforce ?? null;
  const maturityDeps = args.maturityDeps ?? defaultMaturityDeps();

  const run = async (tx: PoolClient): Promise<AtomicApplyResult> => {
    // Owner-check: the item must still be `processing`, the job `running` and
    // locked by THIS worker. Lock both rows so recoverStaleRunning cannot release
    // the item / reset the job between this check and the writes.
    const owner = await queryOneWith<{ ok: number }>(
      tx,
      `SELECT 1 AS ok
         FROM memory_job_items i
         JOIN memory_jobs j ON j.id = i.job_id
        WHERE i.job_id = $1 AND i.candidate_id = $2
          AND i.item_status = 'processing'
          AND j.status = 'running' AND j.locked_by = $3
        FOR UPDATE OF i, j`,
      [args.jobId, args.candidate.id, args.workerId],
    );
    if (!owner) {
      throw new ClaimLostError(args.candidate.id, args.jobId);
    }

    // S5: persist the ledger-grounded outcome + as-of boundary on the candidate
    // BEFORE promote, in the SAME tx (owner-check already locked item+job).
    if (outcome) {
      const upd = await updateCandidateOutcome(args.candidate.id, outcome, boundary, tx);
      if (!upd.ok) {
        throw new Error(
          `applyDecisionAtomically: updateCandidateOutcome failed (${upd.reason}) for candidate ${args.candidate.id}`,
        );
      }
    }

    const applied = await applyDecision(args.candidate, args.plan, args.jobId, tx, {
      // Trade-family promotions carry the world-time validity boundary + the S5
      // outcome_version init. Non-trade paths pass nothing (byte-neutral).
      validFrom: outcome ? boundary : null,
      outcomeVersion: outcome ? 0 : undefined,
    });
    const recorded = await recordDecision(applied.decisionInput, tx);
    if (!recorded.ok) {
      throw new Error(
        `applyDecisionAtomically: recordDecision failed (${recorded.reason}) for candidate ${args.candidate.id}`,
      );
    }

    // S6a reinforcement seam (§8): a `duplicate` reject means this candidate is a
    // 2nd real confirmation of an existing ACTIVE entry. Reinforce that entry
    // (activation↑, maturity advance / decayed→established reactivation; audited)
    // in the SAME tx. Resolved here (not in consolidate) so the read + reinforce
    // are atomic with the decision. A target that no longer resolves (the entry
    // was superseded / archived between recall and apply) is a benign no-op — the
    // candidate is still recorded as a duplicate reject.
    if (reinforce && args.plan.type === "reject") {
      await applyReinforcement(reinforce, args.candidate.id, tx, maturityDeps);
    }

    return { decisionId: recorded.decision.id, decisionType: args.plan.type };
  };

  return args.client ? run(args.client) : withTransaction(run);
}

/**
 * Resolve a reinforcement target to a concrete entry id and reinforce it in the
 * tx (S6a §8). The `candidateId` rides along as the structural `trigger_ref` so
 * the audit row links the reinforcement to its confirming candidate. A
 * content-hash target that no longer resolves to an ACTIVE entry is a benign
 * no-op (the active row was superseded/archived between recall and apply).
 */
async function applyReinforcement(
  target: ReinforcementTarget,
  candidateId: string,
  tx: PoolClient,
  maturityDeps: MaturityDeps,
): Promise<void> {
  let knowledgeId: number | null;
  if (target.kind === "entry") {
    knowledgeId = target.knowledgeId;
  } else {
    const entry = await findActiveByContentHash(target.contentHash, tx);
    knowledgeId = entry?.id ?? null;
  }
  if (knowledgeId === null) return;
  await reinforceEntry(knowledgeId, { candidateId }, tx, maturityDeps);
}

/** Thrown when the owner-check fails — the worker lost the claim. */
export class ClaimLostError extends Error {
  constructor(public readonly candidateId: string, public readonly jobId: number) {
    super(`claim lost for candidate ${candidateId} (job ${jobId})`);
    this.name = "ClaimLostError";
  }
}

// ── Convenience re-exports for the executor ─────────────────────────

export { getCandidateById, getCandidateEmbedding };
