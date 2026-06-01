/**
 * Run-lifecycle commands — `start`, `continue`, `recover`, `stop`.
 * Continue and stop mirror the runtime resume/stop result shapes
 * since both channels share the same main-process dispatcher.
 */

import { z } from "zod";
import { missionRunStatusSchema } from "../sessions.js";
import { sessionIdField, missionIdField } from "./_common.js";

// ── start ───────────────────────────────────────────────────────

export const missionStartInputSchema = z
  .object({
    sessionId: sessionIdField,
    missionId: missionIdField,
  })
  .strict();
export type MissionStartInput = z.infer<typeof missionStartInputSchema>;

export const missionStartResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("dispatched"),
      missionRunId: z.string(),
      sessionId: z.string(),
    })
    .strict(),
  z.object({ outcome: z.literal("mission_not_found") }).strict(),
  z
    .object({
      outcome: z.literal("session_mismatch"),
      expectedSessionId: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("session_has_active_run"),
      missionRunId: z.string(),
      runStatus: missionRunStatusSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("session_not_found") }).strict(),
  z
    .object({ outcome: z.literal("not_accepted"), missionId: z.string() })
    .strict(),
  z
    .object({
      outcome: z.literal("stale_acceptance"),
      currentHash: z.string(),
      acceptedHash: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("not_ready"),
      missingFields: z.array(z.string()).readonly(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("active_run_exists"),
      missionRunId: z.string(),
      runStatus: missionRunStatusSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ outcome: z.literal("provider_unavailable") }).strict(),
]);
export type MissionStartResult = z.infer<typeof missionStartResultSchema>;

// ── continue (delegates to runtime resume dispatcher) ───────────

export const missionContinueInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionContinueInput = z.infer<typeof missionContinueInputSchema>;

export const missionContinueResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("resumed"), runId: z.string() })
    .strict(),
  z
    .object({ outcome: z.literal("already_running"), runId: z.string() })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
  z
    .object({
      outcome: z.literal("blocked_approval"),
      pendingApprovalId: z.string(),
    })
    .strict(),
  z
    .object({ outcome: z.literal("blocked_error"), reason: z.string() })
    .strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type MissionContinueResult = z.infer<typeof missionContinueResultSchema>;

// ── recover ─────────────────────────────────────────────────────

export const missionRecoverInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionRecoverInput = z.infer<typeof missionRecoverInputSchema>;

export const missionRecoverResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("dispatched"),
      missionRunId: z.string(),
      recoveredFromRunId: z.string(),
    })
    .strict(),
  z.object({ outcome: z.literal("no_failed_run") }).strict(),
  z
    .object({
      outcome: z.literal("session_has_active_run"),
      missionRunId: z.string(),
      runStatus: missionRunStatusSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("session_not_found") }).strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ outcome: z.literal("provider_unavailable") }).strict(),
]);
export type MissionRecoverResult = z.infer<typeof missionRecoverResultSchema>;

// ── retry (paused_error recovery — the "Recover" button) ────────
//
// Distinct from `continue`: `continue` (runtime resume dispatcher) owns
// paused_user/paused_wake and refuses paused_error; `retry` claims+resumes
// ONLY a paused_error run. Every other state is classified explicitly so the
// dispatcher is total.

export const missionRetryInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionRetryInput = z.infer<typeof missionRetryInputSchema>;

export const missionRetryResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("resumed"), runId: z.string() }).strict(),
  z
    .object({ outcome: z.literal("already_running"), runId: z.string() })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
  z
    .object({
      outcome: z.literal("blocked_approval"),
      pendingApprovalId: z.string(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("blocked_terminal"),
      status: missionRunStatusSchema,
    })
    .strict(),
  // paused_wake / paused_user → not an error pause; the operator should use
  // Continue, not Recover.
  z
    .object({
      outcome: z.literal("not_recoverable"),
      status: missionRunStatusSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("status_changed") }).strict(),
  z
    .object({
      outcome: z.literal("lease_busy"),
      retryAfterMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);
export type MissionRetryResult = z.infer<typeof missionRetryResultSchema>;

// ── edit (stop the active run → mission back to draft) ──────────
//
// Stops the active run so the operator can collaboratively edit the mission
// contract: the run is terminated (stopped) and the parent mission returns to
// `draft`, so the next user turn routes through the mission-setup prompt and
// `mission_draft_update` becomes callable again. `already_terminal` is a race
// path (no active run by the time the engine resolves it).

export const missionEditInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionEditInput = z.infer<typeof missionEditInputSchema>;

export const missionEditResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("stopped") }).strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
  z.object({ outcome: z.literal("already_terminal") }).strict(),
]);
export type MissionEditResult = z.infer<typeof missionEditResultSchema>;

// ── stop (delegates to runtime stop dispatcher) ─────────────────

export const missionStopInputSchema = z
  .object({ sessionId: sessionIdField })
  .strict();
export type MissionStopInput = z.infer<typeof missionStopInputSchema>;

export const missionStopResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("queued"), requestId: z.string().uuid() })
    .strict(),
  z
    .object({
      outcome: z.literal("already_terminal"),
      status: missionRunStatusSchema,
    })
    .strict(),
  z.object({ outcome: z.literal("no_active_run") }).strict(),
]);
export type MissionStopResult = z.infer<typeof missionStopResultSchema>;
