/**
 * memory_manager module barrel — INTERNAL use-case functions only (FIX-3).
 *
 * NOTHING here is a ToolDef, and nothing is registered in the tool
 * registry / visibility / tool-map. The async memory_manager worker (S4
 * executor) consumes these functions; the agent never reaches them.
 */

export {
  consolidateCandidate,
  applyDecisionAtomically,
  defaultConsolidateDeps,
  ClaimLostError,
  getCandidateById,
  getCandidateEmbedding,
  type ConsolidateDeps,
  type CandidateDecision,
  type AtomicApplyResult,
  type ReinforcementTarget,
} from "./consolidate.js";

export {
  reinforceEntry,
  decayEntry,
  defaultMaturityDeps,
  DECAY_AUDIT_MIN_DELTA,
  type MaturityDeps,
  type ReinforceResult,
  type DecayResult,
} from "./maturity.js";

export {
  ACTIVATION_HALF_LIFE_DAYS,
  DECAY_FLOOR,
  REINFORCE_STEP,
  DECAY_TO_DECAYED_THRESHOLD,
  REACTIVATION_ACTIVATION,
  ACTIVATION_MIN_FACTOR,
  ACTIVATION_MIN_FACTOR_PROVEN_BOUND,
  decayedActivation,
  nextStateOnDecay,
  reinforcedActivation,
  nextStateOnReinforce,
  reinforceEventFor,
  activationFactor,
  daysSince,
} from "./maturity-policy.js";

export {
  applyDecision,
  promote,
  supersedeFromCandidate,
  applyTerminal,
  PromoteRedactionAnomalyError,
  type DecisionPlan,
  type ApplyDecisionResult,
} from "./promote.js";

export {
  runDeterministicStage,
  type DeterministicVerdict,
  type DeterministicInput,
  type EscalationSignals,
  type KnowledgeMatch,
} from "./deterministic-stage.js";

export {
  derefAnchorExistence,
  countRecurrence,
  deriveEvidenceStrengthCeiling,
  type AnchorExistenceResult,
  type AnchorDerefDeps,
} from "./evidence-deref.js";

export {
  resolveOutcome,
  type OutcomeResolverDeps,
} from "./outcome-resolver.js";

export {
  deriveDecisionBoundary,
  checkNoLookahead,
  type ExecTimeRef,
  type ExecTimeDeref,
} from "./point-in-time.js";

export { buildJudgeContext, type JudgeContext } from "./context-builder.js";
export { callJudge, type JudgeProvider, type JudgeCallResult } from "./judge.js";
export {
  judgeVerdictSchema,
  type JudgeVerdict,
  type JudgeVerdictType,
  type JudgeRubric,
} from "./judge-schema.js";
export { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./judge-prompt.js";
export { isGeneralizationKind, isTradeKind } from "./kind-families.js";
