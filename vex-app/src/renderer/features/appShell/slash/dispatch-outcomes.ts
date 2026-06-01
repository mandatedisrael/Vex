/**
 * Per-command outcome → `DispatchOutcome` mappers (puzzle 04 phase 7).
 *
 * Codex phase 7 final review #1: a `Result.ok` from the engine is
 * NOT automatically a user-facing success — the discriminated outcome
 * inside the result can be a refusal (`not_accepted`, `no_active_run`,
 * `blocked_active_run`, `no_checkpoint`, `not_terminal_yet`, etc.).
 * The dispatcher must surface the operational meaning, not the IPC
 * transport status.
 *
 * Each mapper is an exhaustive switch over its result schema's
 * discriminator (TypeScript `never` exhaustion guards against new
 * outcomes silently regressing to a misleading success notice).
 */

import type {
  MissionContinueResult,
  MissionRecoverResult,
  MissionRenewResult,
  MissionRestoreResult,
  MissionRewindResult,
  MissionStartResult,
  MissionStopResult,
} from "@shared/schemas/mission.js";
import type { DispatchOutcome } from "./types.js";

function assertNever(value: never): never {
  throw new Error(`Unhandled outcome: ${JSON.stringify(value)}`);
}

export function mapStartOutcome(data: MissionStartResult): DispatchOutcome {
  switch (data.outcome) {
    case "dispatched":
      return { kind: "success", message: "Mission dispatched." };
    case "mission_not_found":
      return { kind: "error", message: "Mission not found." };
    case "session_mismatch":
      return { kind: "error", message: "Mission belongs to a different session." };
    case "session_not_found":
      return { kind: "error", message: "Session not found." };
    case "provider_unavailable":
      return {
        kind: "error",
        message: "Provider unavailable. Check model + network status.",
      };
    case "session_has_active_run":
      return {
        kind: "blocked",
        message: `Another mission run is in progress (status ${data.runStatus}).`,
      };
    case "active_run_exists":
      return {
        kind: "blocked",
        message: `Mission already has a live run (status ${data.runStatus}).`,
      };
    case "not_accepted":
      return {
        kind: "blocked",
        message: "Accept the contract first, then /mission start.",
      };
    case "stale_acceptance":
      return {
        kind: "blocked",
        message:
          "Contract changed since acceptance. Re-accept the new contract, then start.",
      };
    case "not_ready":
      return {
        kind: "blocked",
        message: `Mission setup incomplete (missing: ${data.missingFields.join(", ")}).`,
      };
    case "lease_busy":
      return {
        kind: "blocked",
        message: "Another runner holds the lease. Try again in a moment.",
      };
    default:
      return assertNever(data);
  }
}

export function mapContinueOutcome(
  data: MissionContinueResult,
): DispatchOutcome {
  switch (data.outcome) {
    case "resumed":
      return { kind: "success", message: "Continue dispatched." };
    case "already_running":
      return { kind: "blocked", message: "Mission run is already running." };
    case "no_active_run":
      return { kind: "blocked", message: "No active mission run to continue." };
    case "blocked_approval":
      return {
        kind: "blocked",
        message: "Resolve the pending approval first.",
      };
    case "blocked_error":
      return {
        kind: "blocked",
        message: `Run paused after error: ${data.reason}. Use /mission recover.`,
      };
    case "lease_busy":
      return {
        kind: "blocked",
        message: "Another runner holds the lease. Try again in a moment.",
      };
    default:
      return assertNever(data);
  }
}

export function mapRecoverOutcome(
  data: MissionRecoverResult,
): DispatchOutcome {
  switch (data.outcome) {
    case "dispatched":
      return { kind: "success", message: "Recovery dispatched." };
    case "no_failed_run":
      return {
        kind: "blocked",
        message: "No failed mission run to recover for this session.",
      };
    case "session_has_active_run":
      return {
        kind: "blocked",
        message: `An active run is already in progress (status ${data.runStatus}).`,
      };
    case "session_not_found":
      return { kind: "error", message: "Session not found." };
    case "lease_busy":
      return {
        kind: "blocked",
        message: "Another runner holds the lease. Try again in a moment.",
      };
    case "provider_unavailable":
      return {
        kind: "error",
        message: "Provider unavailable. Check model + network status.",
      };
    default:
      return assertNever(data);
  }
}

export function mapStopOutcome(data: MissionStopResult): DispatchOutcome {
  switch (data.outcome) {
    case "queued":
      return { kind: "success", message: "Stop queued." };
    case "stopped":
      return { kind: "success", message: "Mission stopped." };
    case "already_terminal":
      return {
        kind: "blocked",
        message: `Mission run already in terminal state (${data.status}).`,
      };
    case "no_active_run":
      return { kind: "blocked", message: "No active mission run to stop." };
    default:
      return assertNever(data);
  }
}

export function mapRewindOutcome(
  data: MissionRewindResult,
  turns: number,
): DispatchOutcome {
  switch (data.outcome) {
    case "rewound":
      return {
        kind: "success",
        message: `Rewound ${turns} user turn${turns === 1 ? "" : "s"} (archived ${data.archivedMessages} messages).`,
      };
    case "noop":
      return {
        kind: "blocked",
        message: "Nothing to rewind — no matching user turn found.",
      };
    case "blocked_active_run":
      return {
        kind: "blocked",
        message: `Cannot rewind while a mission run is active (${data.reason}).`,
      };
    default:
      return assertNever(data);
  }
}

export function mapRestoreOutcome(
  data: MissionRestoreResult,
): DispatchOutcome {
  switch (data.outcome) {
    case "restored":
      return {
        kind: "success",
        message: `Restored ${data.restoredCount} message${data.restoredCount === 1 ? "" : "s"}.`,
      };
    case "noop_already_restored":
      return {
        kind: "success",
        message: "Already restored — no changes.",
      };
    case "no_checkpoint":
      return {
        kind: "blocked",
        message: "No rewind checkpoint to restore.",
      };
    case "session_not_found":
      return { kind: "error", message: "Session not found." };
    case "blocked_active_run":
      return {
        kind: "blocked",
        message: `Cannot restore while a mission run is active (status ${data.runStatus}).`,
      };
    case "blocked_pending_approval":
      return {
        kind: "blocked",
        message: "Resolve the pending approval before restoring.",
      };
    case "lease_busy":
      return {
        kind: "blocked",
        message: "Another runner holds the lease. Try again in a moment.",
      };
    default:
      return assertNever(data);
  }
}

export function mapRenewOutcome(data: MissionRenewResult): DispatchOutcome {
  switch (data.outcome) {
    case "renewed":
      return {
        kind: "success",
        message: `Mission renewed (new mission ${data.newMissionId}). Review and accept the new contract before starting.`,
      };
    case "previous_mission_not_found":
      return { kind: "error", message: "Source mission not found." };
    case "session_mismatch":
      return {
        kind: "error",
        message: "Source mission belongs to a different session.",
      };
    case "not_accepted":
      return {
        kind: "blocked",
        message: "Source mission was never accepted — nothing to renew from.",
      };
    case "not_terminal_yet":
      return {
        kind: "blocked",
        message: `Source mission isn't finished yet (status ${data.runStatus}). Stop or wait for it to terminate first.`,
      };
    case "session_has_active_run":
      return {
        kind: "blocked",
        message: `Session has an active mission run (status ${data.runStatus}). Stop it before renewing.`,
      };
    default:
      return assertNever(data);
  }
}
