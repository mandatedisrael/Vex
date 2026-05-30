/**
 * Pure helpers for `SessionComposer` (puzzle 04 phase 7 extract).
 *
 * Pulled out of `SessionComposer.tsx` so the parent stays under the
 * 350-LOC budget. No React, no hooks — every function is a pure
 * mapper from typed inputs to UI copy (placeholder text, gating
 * reasons, confirm dialog labels per command kind).
 */

import type { Result } from "@shared/ipc/result.js";
import type { ChatSubmitResult } from "@shared/schemas/chat.js";
import type { RuntimeStateDto } from "@shared/schemas/runtime.js";
import type {
  MissionRunStatus,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import { SLASH_COMMAND_LABEL, type SlashCommand } from "./slash/types.js";

export const FREE_TEXT_DISALLOWED: ReadonlySet<MissionRunStatus> = new Set([
  "running",
  "paused_approval",
  "paused_user",
  "paused_wake",
  "paused_error",
]);

export function readRunStatus(
  data: Result<RuntimeStateDto> | undefined,
): MissionRunStatus | null {
  if (!data || !data.ok) return null;
  return data.data.status;
}

export function gatedReason(status: MissionRunStatus | null): string {
  switch (status) {
    case "running":
      return "Mission is running. Use /mission stop first, or wait for the next paused state.";
    case "paused_approval":
      return "Mission is paused for approval. Resolve the approval first.";
    case "paused_user":
      return "Mission is paused by you. Use /mission continue to resume.";
    case "paused_wake":
      return "Mission is waiting on a scheduled wake. Cancel the wake or wait.";
    case "paused_error":
      return "Mission is paused after an error. Use /mission recover.";
    default:
      return "Composer is gated until the mission run reaches a free state.";
  }
}

/**
 * Notice text for a completed chat submit. Shared by the composer's own
 * submit path AND the welcome→create hand-off so mission first-message UX
 * ("Mission goal received.") and the stopped state don't regress to a
 * generic "Message sent."
 */
export function submitSuccessText(data: ChatSubmitResult): string {
  if (data.stopReason === "user_stopped") return "Stopped.";
  // Generic confirmation only — never echo `data.text` (the assistant reply),
  // which already renders in the transcript bubble + streaming preview. Echoing
  // it here duplicated the whole reply below the composer input.
  return data.treatedAsInitialGoal ? "Mission goal received." : "Message sent.";
}

export function placeholderFor(session: SessionListItem | null): string {
  if (session?.mode !== "mission") return "What do you want Vex to do?";
  const goal = session.initialGoal?.trim();
  if (goal === undefined || goal.length === 0) {
    return "Describe the mission goal.";
  }
  return "Type a follow-up or a slash command (/mission start, /rewind 3, …).";
}

export function confirmTitle(command: SlashCommand | undefined): string {
  if (command === undefined) return "";
  if (command.kind === "rewind") {
    return `Rewind ${command.turns} user turn${command.turns === 1 ? "" : "s"}?`;
  }
  return `${SLASH_COMMAND_LABEL[command.kind]}?`;
}

export function confirmDescription(command: SlashCommand | undefined): string {
  if (command === undefined) return "";
  switch (command.kind) {
    case "rewind":
      return "Archives the live transcript suffix from the chosen user turn. You can /restore the archived range later.";
    case "restore":
      return "Restores the most recent rewind checkpoint. Archived messages move back into the live transcript.";
    case "mission-renew":
      return "Creates a fresh mission draft from the most recent completed contract. The renewed mission won't start automatically — accept the contract first.";
    default:
      return "";
  }
}

export function confirmLabel(command: SlashCommand | undefined): string {
  if (command === undefined) return "Confirm";
  switch (command.kind) {
    case "rewind":
      return "Rewind";
    case "restore":
      return "Restore";
    case "mission-renew":
      return "Renew";
    default:
      return "Confirm";
  }
}

export function confirmTone(
  command: SlashCommand | undefined,
): "destructive" | "primary" {
  if (command === undefined) return "primary";
  if (command.kind === "rewind") return "destructive";
  return "primary";
}
