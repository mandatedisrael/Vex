/**
 * Approvals schemas — pending queue + history summaries.
 *
 * Renderer NEVER receives the raw `approval_queue.tool_call` /
 * `pending_context` JSONB. The main-side mapper in
 * `vex-app/src/main/database/approvals-db.ts` is the single place
 * where those JSONB blobs get reduced to allow-listed DTO fields:
 *   - `toolName` (best-effort `namespace:command`),
 *   - `toolCallId`,
 *   - `permissionAtEnqueue`,
 *   - `reasoningPreview` (first 200 chars of `reasoning`).
 *
 * Pending approve/reject mutations fail closed with
 * `approvals.feature_unavailable` until puzzle 05 lands the durable
 * intents + idempotent runtime continuation. The Result-typed contract
 * ships now so the renderer hook surface compiles end-to-end.
 *
 * Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` (`sessionId`, `toolCallId`, `toolName`).
 */

import { z } from "zod";

export const APPROVAL_REASONING_PREVIEW_MAX = 200;
export const APPROVAL_HISTORY_DEFAULT_LIMIT = 20;
export const APPROVAL_HISTORY_MAX_LIMIT = 100;

/** Mirrors the `approval_queue.status` CHECK from migration 001. */
export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** Mirrors the `approval_queue.permission_at_enqueue` CHECK. */
export const approvalPermissionSchema = z.enum(["restricted", "full"]);
export type ApprovalPermission = z.infer<typeof approvalPermissionSchema>;

/**
 * Mirrors the `approval_intents.action_kind` CHECK from migration 024.
 * Same 8 variants as `src/vex-agent/tools/taxonomy.ts::ACTION_KINDS`; kept
 * as a separate Zod schema here so the renderer schema layer does not
 * depend on the agent runtime. Adding a variant requires updating both
 * sides — `protocol-taxonomy.test.ts` + `registry-taxonomy.test.ts` pin
 * the agent side; consumers of this Zod schema pin the renderer side.
 */
export const approvalActionKindSchema = z.enum([
  "read",
  "local_write",
  "schedule",
  "approval_prepare",
  "user_wallet_broadcast",
  "provider_action_request",
  "external_post",
  "destructive",
]);
export type ApprovalActionKind = z.infer<typeof approvalActionKindSchema>;

/** Mirrors `approval_intents.risk_level` CHECK from migration 024. */
export const approvalRiskLevelSchema = z.enum([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);
export type ApprovalRiskLevel = z.infer<typeof approvalRiskLevelSchema>;

/**
 * Mirrors `approval_intents.decision` CHECK from migration 024. Phase 2 only
 * writes the intent row at enqueue (decision is NULL until phase 3 runtime
 * lands); `rejected_stop` is included now because phase 3 reject-and-stop UI
 * will gate against the same CHECK.
 */
export const approvalDecisionSchema = z.enum([
  "approved",
  "rejected",
  "rejected_stop",
]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/** Mirrors `approval_intents.execution_status` CHECK from migration 024. */
export const approvalExecutionStatusSchema = z.enum([
  "not_started",
  "dispatching",
  "succeeded",
  "failed",
]);
export type ApprovalExecutionStatus = z.infer<
  typeof approvalExecutionStatusSchema
>;

/**
 * Renderer-safe preview projection from `approval_intents.preview_json`.
 * The main-side mapper allow-lists keys via the same defensive style as
 * `extractToolName`: never recurses, never returns raw blobs. Values are
 * coerced to JSON-safe scalars (strings ≤200 chars, numbers, booleans, null).
 * Strict schema means an unexpected shape at the boundary is rejected.
 */
export const approvalPreviewSchema = z
  .object({
    toolName: z.string(),
    namespace: z.string().optional(),
    criticalArgs: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;

export const approvalSummaryDtoSchema = z
  .object({
    id: z.string().min(1),
    /**
     * `approval_queue.session_id` is nullable in the DB (the engine can
     * enqueue session-less approvals from non-chat sources). UI may
     * filter on this; the renderer surfaces the value as-is.
     */
    sessionId: z.string().uuid().nullable(),
    toolCallId: z.string().nullable(),
    /**
     * Best-effort tool identifier extracted from `tool_call` JSONB
     * (preferred: `namespace:command` when both are strings; fallback
     * `command`, `name`, finally `"unknown"`). Refined when tool
     * registry metadata is wired in puzzle 05.
     */
    toolName: z.string().nullable(),
    status: approvalStatusSchema,
    permissionAtEnqueue: approvalPermissionSchema,
    createdAt: z.string().datetime({ offset: true }),
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    /** First 200 chars of `approval_queue.reasoning`, no JSONB leakage. */
    reasoningPreview: z.string().max(APPROVAL_REASONING_PREVIEW_MAX),
    /**
     * Puzzle 5 phase 2 — `approval_intents` companion fields. Populated only
     * when an intent row exists for this approval (back-compat with rows
     * predating migration 024); the mapper LEFT JOIN tolerates the absence.
     * Phase 3 wires the `decision` / `decisionReason` / `executionStatus`
     * lifecycle; phase 2 always exposes those as null.
     */
    actionKind: approvalActionKindSchema.nullable(),
    riskLevel: approvalRiskLevelSchema.nullable(),
    preview: approvalPreviewSchema.nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
    decision: approvalDecisionSchema.nullable(),
    decisionReason: z.string().nullable(),
    executionStatus: approvalExecutionStatusSchema.nullable(),
  })
  .strict();
export type ApprovalSummaryDto = z.infer<typeof approvalSummaryDtoSchema>;

export const approvalListPendingInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type ApprovalListPendingInput = z.infer<
  typeof approvalListPendingInputSchema
>;

export const approvalGetInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type ApprovalGetInput = z.infer<typeof approvalGetInputSchema>;

export const approvalGetHistoryInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(APPROVAL_HISTORY_MAX_LIMIT)
      .default(APPROVAL_HISTORY_DEFAULT_LIMIT),
  })
  .strict();
export type ApprovalGetHistoryInput = z.infer<
  typeof approvalGetHistoryInputSchema
>;

export const approvalActionInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type ApprovalActionInput = z.infer<typeof approvalActionInputSchema>;

/**
 * Future-shape contract for `approvals.approve`/`approvals.reject`.
 * Puzzle 1 fail-closes with `approvals.feature_unavailable`; puzzle 05
 * fills the body. The Result-typed contract is exported so renderer
 * hooks + preload validators compile against the eventual shape.
 */
export const approvalActionResultSchema = z
  .object({
    id: z.string().min(1),
    status: approvalStatusSchema,
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    /** Action outcome: did the decision actually resume runtime / dispatch the tool? */
    runtimeOutcome: z.enum(["resumed", "stopped", "unavailable"]),
    message: z.string(),
  })
  .strict();
export type ApprovalActionResult = z.infer<typeof approvalActionResultSchema>;
