/**
 * Chat IPC schemas.
 *
 * `vex.chat.submit` is the renderer's single typed path for operator text.
 * For mission sessions, the first submit also becomes the initial goal
 * snapshot; the engine then continues through mission setup.
 */

import { z } from "zod";
import { INITIAL_GOAL_MAX_LENGTH } from "./sessions.js";

export const CHAT_MESSAGE_MAX_LENGTH = INITIAL_GOAL_MAX_LENGTH;

/**
 * Operator-facing reasoning effort (S6). Deliberately a SUBSET of what
 * OpenRouter accepts ("xhigh"/"minimal"/"none" are not exposed in v1):
 * three levels are meaningful to users, and "off" is not a choice — the
 * engine omits the reasoning param entirely for models without reasoning
 * support, and reasoning-capable models always run at least "low"
 * (engine default: "medium"). Mirrors `ReasoningEffort` in
 * `src/vex-agent/inference/types.ts`.
 */
export const reasoningEffortSchema = z.enum(["low", "medium", "high"]);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

export const chatSubmitInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    message: z
      .string()
      .trim()
      .min(1, "Message is required.")
      .max(
        CHAT_MESSAGE_MAX_LENGTH,
        `Message must be ${CHAT_MESSAGE_MAX_LENGTH} characters or less.`,
      ),
    /**
     * Per-turn reasoning effort (S6). Optional + additive: the renderer
     * sends it ONLY when the active model supports reasoning; absent means
     * "engine default" ("medium" when the model supports reasoning, no
     * reasoning param otherwise). Ignored by mission interrupt/resume paths.
     */
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .strict();
export type ChatSubmitInput = z.infer<typeof chatSubmitInputSchema>;

/**
 * Mirrors the engine's `StopReason` union (src/vex-agent/engine/types.ts).
 * Must stay a SUPERSET of what `chat.submit` can surface: the handler pipes
 * `submitOperatorInstruction(...).stopReason` straight into the validated
 * output, and the ingress `paused_wake` preempt branch returns a full
 * `resumeMissionRun` TurnResult — so ANY turn-loop stop reason (including
 * `user_paused` from the pause control and `plan_acceptance_required` from
 * a mission-run `plan_write`) can reach this schema. A missing member here
 * turns a successful turn into an `internal.unexpected` IPC error (S7 fix
 * for the S6 finding; pinned by sessions-chat.test.ts).
 */
export const chatStopReasonSchema = z.enum([
  "goal_reached",
  "deadline_reached",
  "capital_depleted",
  "max_loss_hit",
  "no_viable_opportunity",
  "emergency_stop",
  "user_stopped",
  "approval_required",
  "checkpoint_pause",
  "iteration_limit",
  "timeout",
  "waiting_for_parent",
  "waiting_for_wake",
  "waiting_for_compact_commit",
  "compact_unable_at_critical",
  "system_error",
  "user_paused",
  "plan_acceptance_required",
]);
export type ChatStopReason = z.infer<typeof chatStopReasonSchema>;

export const chatMissionStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type ChatMissionStatus = z.infer<typeof chatMissionStatusSchema>;

export const chatSubmitResultSchema = z
  .object({
    text: z.string().nullable(),
    toolCallsMade: z.number().int().min(0),
    pendingApprovals: z.array(z.string()),
    stopReason: chatStopReasonSchema.nullable(),
    missionStatus: chatMissionStatusSchema.nullable(),
    treatedAsInitialGoal: z.boolean(),
  })
  .strict();
export type ChatSubmitResult = z.infer<typeof chatSubmitResultSchema>;
