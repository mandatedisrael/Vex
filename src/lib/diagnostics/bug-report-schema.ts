/**
 * Shared Zod schemas for the local bug-report IPC boundary.
 *
 * Lives in src/lib/ so vex-app main + preload + renderer + (Phase 2) vex-agent
 * runtime all reference the same contract via @vex-lib. Pure module (no
 * Electron, no React, no DB) — see vex-process-boundaries skill.
 *
 * Category field is TEXT validated by a snake_case regex (NOT an enum) so
 * Phase 2 / Phase 3 can introduce new categories without a schema migration
 * or coordinated bump of preload+main+renderer. The MANUAL_CATEGORIES and
 * KNOWN_AUTOMATIC_CATEGORIES const arrays document the current set without
 * constraining the regex.
 */

import { z } from "zod";

/** Match the SQL CHECK in `019_bug_reports.sql` — snake_case, 3–81 chars. */
export const SUPPORT_CATEGORY_REGEX = /^[a-z][a-z0-9_]{2,80}$/;

/** Phase 1 user-initiated manual categories (UI-facing select). */
export const MANUAL_CATEGORIES = [
  "user_reported_bug",
  "user_reported_confusion",
] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

/**
 * Phase 2+ programmatic categories. NOT enforced as an enum at the schema
 * boundary — the regex is the gate. This array is the documented set so
 * callers know which strings the agent runtime will emit.
 */
export const KNOWN_AUTOMATIC_CATEGORIES = [
  "renderer_caught_error",
  "renderer_uncaught_error",
  "renderer_unhandled_rejection",
  "main_uncaught_exception",
  "main_unhandled_rejection",
  "ipc_validation_failure",
  "database_unavailable",
  "database_migration_failure",
  "docker_detection_failure",
  "docker_compose_failure",
  "inference_provider_failure",
  "embedding_failure",
  "mission_paused_error",
  "mission_system_error",
  "compact_unable_at_critical",
  "tool_dispatch_failure",
  "protocol_execution_failure",
  "protocol_capture_rejection",
  "sync_worker_failure",
  "wake_resume_failure",
  "subagent_lifecycle_failure",
  "redaction_anomaly",
] as const;

export const bugReportCategorySchema = z
  .string()
  .regex(SUPPORT_CATEGORY_REGEX, "category must be snake_case 3–81 chars");

export const bugReportSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);

export const bugReportReportKindSchema = z.enum(["manual", "automatic"]);
export const bugReportSourceSchema = z.enum([
  "user",
  "renderer",
  "main",
  "agent",
  "worker",
]);

export const bugReportUploadStateSchema = z.enum([
  "not_configured",
  "queued",
  "uploading",
  "uploaded",
  "failed",
]);

export const bugReportRefsSchema = z
  .object({
    correlationId: z.string().max(128).optional(),
    sessionId: z.string().max(128).optional(),
    missionId: z.string().max(128).optional(),
    missionRunId: z.string().max(128).optional(),
    subagentId: z.string().max(128).optional(),
    toolName: z.string().max(128).optional(),
    toolCallId: z.string().max(128).optional(),
    protocolNamespace: z.string().max(128).optional(),
    compactJobId: z.number().int().positive().optional(),
  })
  .strict();

export const createBugReportInputSchema = z
  .object({
    reportKind: bugReportReportKindSchema,
    source: bugReportSourceSchema,
    category: bugReportCategorySchema,
    severity: bugReportSeveritySchema.default("error"),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(8000).default(""),
    context: z.record(z.string(), z.unknown()).default({}),
    refs: bugReportRefsSchema.default({}),
  })
  .strict();

export type CreateBugReportInput = z.infer<typeof createBugReportInputSchema>;

export const createBugReportResultSchema = z
  .object({
    reportId: z.string().uuid(),
    recorded: z.boolean(),
    uploadState: bugReportUploadStateSchema,
  })
  .strict();

export type CreateBugReportResult = z.infer<typeof createBugReportResultSchema>;
