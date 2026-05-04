/**
 * Engine types — pure domain types for the engine layer.
 *
 * No DB imports, no inference imports. These types define the
 * engine's vocabulary: session axes, mission lifecycle, stop
 * conditions, message taxonomy, and context contracts.
 */

// ── Session axes ────────────────────────────────────────────────

/**
 * Engine-level session discriminator.
 *
 * `"chat"` and `"mission"` are the classic routing targets. `"full_autonomous"`
 * (PR-10) unlocks the standalone full-autonomous runner — a session that
 * loops on `loop_defer` + wake without needing an owning mission. The
 * session-level `kind` column on `sessions` is the source of truth; this
 * type is propagated through `EngineContext` and `InternalToolContext` so
 * tool visibility and prompt shaping can branch on it.
 */
export type SessionKind = "chat" | "mission" | "full_autonomous";

export type LoopMode = "off" | "restricted" | "full";

// ── Mission lifecycle ───────────────────────────────────────────

export type MissionStatus =
  | "draft"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionRunStatus =
  | "running"
  | "paused_approval"
  | "paused_wake"
  | "paused_error"
  | "completed"
  | "failed"
  | "stopped"
  | "cancelled";

/**
 * Centralised classification of `MissionRunStatus` values. Engine, repo,
 * ingress router and UI cockpit MUST consult these sets rather than
 * enumerating literals so a new arm (e.g. `paused_error`) flows through
 * every decision point automatically.
 */
export const ACTIVE_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set(["running"]);
export const PAUSED_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  "paused_approval",
  "paused_wake",
  "paused_error",
]);
export const TERMINAL_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "cancelled",
]);
export const ACTIVE_OR_PAUSED_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  ...ACTIVE_RUN_STATUSES,
  ...PAUSED_RUN_STATUSES,
]);

export type FullAutonomousRunStatus =
  | "running"
  | "paused_wake"
  | "paused_error"
  | "stopped"
  | "failed";

export const ACTIVE_FULL_AUTONOMOUS_STATUSES: ReadonlySet<FullAutonomousRunStatus> = new Set(["running"]);
export const PAUSED_FULL_AUTONOMOUS_STATUSES: ReadonlySet<FullAutonomousRunStatus> = new Set([
  "paused_wake",
  "paused_error",
]);
export const TERMINAL_FULL_AUTONOMOUS_STATUSES: ReadonlySet<FullAutonomousRunStatus> = new Set([
  "stopped",
  "failed",
]);
export const ACTIVE_OR_PAUSED_FULL_AUTONOMOUS_STATUSES: ReadonlySet<FullAutonomousRunStatus> = new Set([
  ...ACTIVE_FULL_AUTONOMOUS_STATUSES,
  ...PAUSED_FULL_AUTONOMOUS_STATUSES,
]);

/**
 * Recoverable failure surfaced by `startMission` / `resumeMissionRun` when a
 * provider call (or the surrounding hydrate / status update / prompt prep)
 * throws. The run is persisted in `paused_error` first, then this error is
 * re-thrown so shell action wrappers map it to `{ ok:false }` and the UI
 * shows a real failure with a recovery hint instead of a fake "started" line.
 *
 * Carries the original `cause` so callers can inspect or surface it.
 */
export class MissionRunPausedError extends Error {
  readonly runId: string;
  readonly missionId: string;
  readonly sessionId: string;
  constructor(args: {
    runId: string;
    missionId: string;
    sessionId: string;
    cause: unknown;
  }) {
    const causeMessage =
      args.cause instanceof Error ? args.cause.message : String(args.cause);
    super(causeMessage, { cause: args.cause });
    this.name = "MissionRunPausedError";
    this.runId = args.runId;
    this.missionId = args.missionId;
    this.sessionId = args.sessionId;
  }
}

// ── Stop conditions ─────────────────────────────────────────────

export type BusinessStopReason =
  | "goal_reached"
  | "deadline_reached"
  | "capital_depleted"
  | "max_loss_hit"
  | "no_viable_opportunity"
  | "emergency_stop"
  | "user_stopped";

export type RuntimeStopReason =
  | "approval_required"
  | "checkpoint_pause"
  | "iteration_limit"
  | "timeout"
  | "waiting_for_parent"
  | "waiting_for_wake"
  | "system_error";

export type StopReason = BusinessStopReason | RuntimeStopReason;

// ── Message taxonomy ────────────────────────────────────────────

export type MessageSource =
  | "user"
  | "assistant"
  | "engine"
  | "tool"
  | "subagent"
  | "system";

export type MessageType =
  | "chat"
  | "mission_setup"
  | "mission_summary"
  | "mission_recovered"
  | "mission_started"
  | "operator_interrupt"
  | "approval_pause"
  | "continue"
  | "checkpoint"
  | "wake_due"
  | "subagent_relay"
  | "tool_result";

export type MessageVisibility = "user" | "internal";

// ── Mission draft — domain model (camelCase, typed) ─────────────

/** Required fields for a mission to transition from draft → ready. */
export interface MissionDraft {
  title: string | null;
  goal: string | null;
  capitalSource: string | null;
  startingCapital: string | null;
  allowedWallets: string[] | null;
  allowedChains: string[] | null;
  allowedProtocols: string[] | null;
  riskProfile: string | null;
  successCriteria: string[] | null;
  stopConditions: string[] | null;
  /** True only after the user directly provides or accepts stop conditions. */
  stopConditionsAccepted?: boolean | null;
  /** Optional — mission may have no deadline. */
  deadline: string | null;
}

/**
 * Required fields that must be non-null for draft → ready transition.
 * `deadline` is intentionally excluded — it's optional.
 */
export const MISSION_DRAFT_REQUIRED_FIELDS: readonly (keyof MissionDraft)[] = [
  "title",
  "goal",
  "capitalSource",
  "startingCapital",
  "allowedWallets",
  "allowedChains",
  "allowedProtocols",
  "riskProfile",
  "successCriteria",
  "stopConditions",
] as const;

// ── Mission patch — untrusted model output ──────────────────────

/** Raw patch from model — must be validated/sanitized before DB write. */
export interface MissionPatch {
  [key: string]: unknown;
}

// ── Engine context ──────────────────────────────────────────────

/** Passed to runner, turn, prompt stack — everything the engine needs. */
export interface EngineContext {
  sessionId: string;
  sessionKind: SessionKind;
  loopMode: LoopMode;
  missionId: string | null;
  missionRunId: string | null;
  /** Active full-autonomous run id. Null outside standalone full-auto loops. */
  fullAutonomousRunId?: string | null;
  /** Session creation time from DB; used only for runtime clock prompt context. */
  sessionStartedAt?: string | null;
  /** Active mission run start time from DB; null outside active mission runs. */
  missionRunStartedAt?: string | null;
  /** Optional mission deadline from the frozen mission constraints. */
  missionDeadline?: string | null;
  isSubagent: boolean;
  loadedDocuments: Map<string, string>;
  /**
   * Semantic memory scope — the identity that `session_episodes` recall groups
   * on. Distinct from the coarse `sessions.scope` (chat/mcp/subagent). Default
   * in `hydrate` is the session id; subagents inherit the parent's scope so
   * their checkpoints contribute to the parent's memory.
   */
  memoryScopeKey: string;
}

// ── Turn result ─────────────────────────────────────────────────

/** Returned from engine entry points (processChatTurn, startMission, etc.) */
export interface TurnResult {
  /** Text response from model — null when only tool calls were made. */
  text: string | null;
  /** Number of tool calls dispatched during this turn/loop. */
  toolCallsMade: number;
  /** Approval IDs enqueued during this turn (for restricted mode). */
  pendingApprovals: string[];
  /** If the run stopped, the reason. Null if still running or chat mode. */
  stopReason: StopReason | null;
  /** Current mission status after this turn. Null for chat sessions. */
  missionStatus: MissionStatus | null;
}

// ── Message metadata ────────────────────────────────────────────

/** Engine metadata attached to messages — extends the base message model. */
export interface MessageMetadata {
  source?: MessageSource;
  messageType?: MessageType;
  visibility?: MessageVisibility;
  originSessionId?: string;
  subagentId?: string;
}
