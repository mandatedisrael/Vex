/**
 * Shell engine actions — pure, UI-free wrappers around engine / repo calls.
 *
 * The Ink app (and the @clack wizard) imports these; UI layers stay dumb.
 * Nothing here writes to stdout/stderr or spawns prompts — callers render
 * results themselves. Errors are caught and returned as structured
 * `ActionResult` so the UI can format them without try/catch everywhere.
 *
 * Shared with the old readline shell only in spirit — old `commands.ts`
 * was not modified (plan 2B: new shell reuses through imports, old shell
 * keeps its own handlers until 2E cleanup).
 */

import {
  abortActiveMissionForSession,
  approveAndResume,
  MissionRunPausedError,
  processMissionSetupTurn,
  recoverFailedMissionRun,
  rejectApproval,
  retryActiveMissionRun,
  rewindSession,
  runTool,
  startMission,
  stopActiveMissionForEdit,
  type RewindOutcome,
} from "../../src/vex-agent/engine/index.js";
import * as missionsRepo from "../../src/vex-agent/db/repos/missions.js";
import {
  formatMissingMissionFields,
  getMissionSetupState,
} from "../../src/vex-agent/engine/mission/setup.js";
import type { TurnResult, MissionStatus } from "../../src/vex-agent/engine/types.js";
import type { ToolResult } from "../../src/vex-agent/tools/types.js";
import { switchProvider } from "../../src/vex-agent/inference/registry.js";
import type { InferenceProvider } from "../../src/vex-agent/inference/types.js";

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; hint?: string };

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Mission ─────────────────────────────────────────────────────

/**
 * Drive a mission-setup turn — used from `/mission start <goal>` style entry
 * (ingress would otherwise route a draft-less session to chat). Returns the
 * raw `TurnResult` so the UI can surface pending approvals, stop reason, or
 * mission status directly.
 */
export async function startMissionFromSetup(
  sessionId: string,
  userInput: string,
): Promise<ActionResult<TurnResult>> {
  try {
    const result = await processMissionSetupTurn(sessionId, userInput);
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Start the "ready" mission attached to the session. The caller (UI / hotkey)
 * has already ensured `missionStatus === "ready"`; this action wraps the
 * lookup + `startMission` handshake so the UI only deals with a single
 * promise. Permission is read from the session row by the engine — no longer
 * passed in.
 */
export async function startReadyMission(
  sessionId: string,
): Promise<ActionResult<TurnResult>> {
  try {
    const mission = await missionsRepo.getMissionBySession(sessionId);
    if (!mission) {
      return {
        ok: false,
        error: "No mission draft on this session.",
        hint: "Describe the mission goal first, then run /mission start when the draft is ready.",
      };
    }
    if (mission.status !== "ready") {
      const setupState = await getMissionSetupState(mission.id);
      const missingFields = setupState
        ? formatMissingMissionFields(setupState.missingFields)
        : "unknown";
      return {
        ok: false,
        error: `Mission status is "${mission.status}", not "ready".`,
        hint: `Missing fields: ${missingFields}. Ask the agent to save the complete draft with mission_draft_update before starting.`,
      };
    }
    const result = await startMission(mission.id);
    return { ok: true, value: result };
  } catch (err) {
    if (err instanceof MissionRunPausedError) {
      return {
        ok: false,
        error: toErrorMessage(err),
        hint: "Run was created but paused after a runtime error. Fix the issue then /retry, or /rewind.",
      };
    }
    return { ok: false, error: toErrorMessage(err) };
  }
}

export interface EditMissionOutcome {
  stoppedActiveRun: boolean;
  rejectedApprovals: number;
  setup: TurnResult;
}

export async function editMissionDraft(
  sessionId: string,
  instruction?: string,
): Promise<ActionResult<EditMissionOutcome>> {
  try {
    const mission = await missionsRepo.getMissionBySession(sessionId);
    if (!mission) {
      return {
        ok: false,
        error: "No mission draft on this session.",
        hint: "Describe the mission goal first so the shell can create a draft.",
      };
    }

    const stopped = await stopActiveMissionForEdit(sessionId);
    if (mission.status !== "draft") {
      await missionsRepo.clearApprovedAt(mission.id);
      await missionsRepo.setStatus(mission.id, "draft");
    }

    const setupPrompt = instruction?.trim()
      ? `Edit the current mission draft with this operator request: ${instruction.trim()}`
      : "The operator requested mission edit mode. Show the current draft and ask what should change.";
    const setup = await processMissionSetupTurn(sessionId, setupPrompt);

    return {
      ok: true,
      value: {
        stoppedActiveRun: stopped?.stopped ?? false,
        rejectedApprovals: stopped?.rejectedApprovals ?? 0,
        setup,
      },
    };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

export interface AbortOutcome {
  /** True when the call actually changed state; false when the run was already terminal or absent. */
  aborted: boolean;
  /** Mission status after the call (may still be "running" briefly — loop finalises async). */
  status: MissionStatus | null;
  /** Number of pending approvals rejected as part of the abort. */
  rejectedApprovals: number;
}

/**
 * Abort any active mission run for the session. Rejects pending approvals,
 * signals the run's AbortController, and finalises status. Safe to call when
 * no mission is active — returns `aborted: false, status: null` so the UI
 * can render a "nothing to abort" hint without pre-checking.
 */
export async function abortActiveMission(
  sessionId: string,
): Promise<ActionResult<AbortOutcome>> {
  try {
    const outcome = await abortActiveMissionForSession(sessionId);
    if (!outcome) {
      return { ok: true, value: { aborted: false, status: null, rejectedApprovals: 0 } };
    }
    return {
      ok: true,
      value: {
        aborted: outcome.aborted,
        status: outcome.finalStatus,
        rejectedApprovals: outcome.rejectedApprovals,
      },
    };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

// ── Retry / Rewind ──────────────────────────────────────────────

/**
 * Re-enter the active mission run after `paused_error` or `paused_wake`.
 *
 * Surfaces two distinct error shapes:
 *   - Engine threw a generic recoverable error (e.g. "no active run") →
 *     plain `{ ok: false, error }`.
 *   - Engine threw `MissionRunPausedError` (the loop just paused itself
 *     again on retry) → include a hint pointing at /retry / /rewind so the
 *     operator knows how to escalate without re-reading docs.
 */
export async function retryMission(
  sessionId: string,
): Promise<ActionResult<TurnResult>> {
  try {
    const result = await retryActiveMissionRun(sessionId);
    return { ok: true, value: result };
  } catch (err) {
    if (err instanceof MissionRunPausedError) {
      return {
        ok: false,
        error: toErrorMessage(err),
        hint: "Run is still paused after retry — fix the underlying issue then /retry again, or /rewind to roll back.",
      };
    }
    return { ok: false, error: toErrorMessage(err) };
  }
}

export async function recoverMission(
  sessionId: string,
): Promise<ActionResult<TurnResult>> {
  try {
    const result = await recoverFailedMissionRun(sessionId);
    return { ok: true, value: result };
  } catch (err) {
    if (err instanceof MissionRunPausedError) {
      return {
        ok: false,
        error: toErrorMessage(err),
        hint: "Recovered run paused immediately — fix the underlying issue then /retry, or /rewind.",
      };
    }
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Soft-rewind the last N user → assistant exchanges. Validates `turns` at
 * the boundary so the engine layer never sees an out-of-range value.
 */
export async function rewindShellSession(
  sessionId: string,
  turns: number,
): Promise<ActionResult<RewindOutcome>> {
  if (!Number.isInteger(turns) || turns < 1 || turns > 50) {
    return {
      ok: false,
      error: `Invalid rewind count: ${turns}.`,
      hint: "Usage: /rewind [N] where N is an integer between 1 and 50.",
    };
  }
  try {
    const outcome = await rewindSession(sessionId, turns);
    return { ok: true, value: outcome };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

// ── Approvals ───────────────────────────────────────────────────

/**
 * Approve a pending tool-call by ID and resume the run. Returns the engine
 * `TurnResult` from the resumed iteration so the UI can render the follow-up
 * text / tool-calls / next approvals.
 */
export async function approveById(
  approvalId: string,
): Promise<ActionResult<TurnResult>> {
  try {
    const result = await approveAndResume(approvalId);
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

/**
 * Reject a single pending approval. Wraps engine's `rejectApproval` (CAS-safe
 * — `rejected: false` when already resolved). Does NOT abort the mission.
 */
export async function rejectById(
  approvalId: string,
): Promise<ActionResult<{ rejected: boolean }>> {
  try {
    const item = await rejectApproval(approvalId);
    return { ok: true, value: { rejected: item !== null } };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

// ── Direct tool invocation ──────────────────────────────────────

/**
 * Power-user direct tool dispatch — bypasses the LLM. Returns the raw
 * `ToolResult` (success flag + output + optional engine signal). Used from
 * the Tools tab in the settings panel.
 */
export async function directRunTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ActionResult<ToolResult>> {
  try {
    const result = await runTool(sessionId, name, args);
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}

// ── Provider ────────────────────────────────────────────────────

/**
 * Switch the active inference provider in-process. Does NOT run guided
 * credential/setup flows — those live in the UI layer (2C+). Call this after
 * the wizard has persisted `OPENROUTER_API_KEY` / `AGENT_MODEL`;
 * `switchProvider` then resolves the provider factory.
 */
export async function switchProviderFlow(
  name: "openrouter",
): Promise<ActionResult<InferenceProvider>> {
  try {
    const provider = await switchProvider(name);
    if (!provider) {
      return {
        ok: false,
        error: `switchProvider("${name}") returned null.`,
        hint: "Check OPENROUTER_API_KEY + AGENT_MODEL in ~/.vex/.env.",
      };
    }
    return { ok: true, value: provider };
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) };
  }
}
