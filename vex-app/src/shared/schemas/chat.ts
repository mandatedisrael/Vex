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
  })
  .strict();
export type ChatSubmitInput = z.infer<typeof chatSubmitInputSchema>;

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
