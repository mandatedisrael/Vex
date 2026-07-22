/**
 * Shared row shape, column list, and row -> BugReport mapping for the
 * bug-reports DB repository.
 *
 * Single-sourced here so the `BugReportRow` shape, the `BUG_REPORT_COLUMNS`
 * list, and the `mapRow` projection cannot drift across the `create` /
 * `read` / `upload-attempt` consumers.
 */

import type {
  BugReport,
  BugReportKind,
  BugReportSeverity,
  BugReportSource,
  BugReportStatus,
  BugReportUploadState,
  ContextPressureBand,
} from "./types.js";

export interface BugReportRow {
  readonly id: string;
  readonly report_kind: string;
  readonly source: string;
  readonly category: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly upload_state: string;
  readonly upload_attempt_count: number;
  readonly next_upload_at: string | Date | null;
  readonly last_upload_error: string | null;
  readonly remote_report_id: string | null;
  readonly uploaded_at: string | Date | null;
  readonly app_version: string | null;
  readonly os_platform: string | null;
  readonly install_id: string | null;
  readonly correlation_id: string | null;
  readonly session_id: string | null;
  readonly mission_id: string | null;
  readonly mission_run_id: string | null;
  readonly tool_name: string | null;
  readonly tool_call_id: string | null;
  readonly protocol_namespace: string | null;
  readonly compact_job_id: number | null;
  readonly stop_reason: string | null;
  readonly runtime_status: string | null;
  readonly context_pressure_band: string | null;
  readonly context_pressure_fraction: string | number | null;
  readonly checkpoint_generation: number | null;
  readonly post_compact_bridge_active: boolean | null;
  readonly redaction_hard_count: number;
  readonly redaction_mask_count: number;
  readonly sanitized_context: Record<string, unknown> | null;
  readonly attachments: ReadonlyArray<unknown> | null;
  readonly retention_until: string | Date | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export const BUG_REPORT_COLUMNS = `
  id, report_kind, source, category, severity, title, description, status,
  upload_state, upload_attempt_count, next_upload_at, last_upload_error,
  remote_report_id, uploaded_at,
  app_version, os_platform, install_id,
  correlation_id, session_id, mission_id, mission_run_id,
  tool_name, tool_call_id, protocol_namespace, compact_job_id,
  stop_reason, runtime_status,
  context_pressure_band, context_pressure_fraction,
  checkpoint_generation, post_compact_bridge_active,
  redaction_hard_count, redaction_mask_count,
  sanitized_context, attachments, retention_until,
  created_at, updated_at
`;

function toIsoOrNull(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function pressureBandOrNull(raw: string | null): ContextPressureBand | null {
  if (raw === null) return null;
  if (
    raw === "normal" ||
    raw === "warning" ||
    raw === "barrier" ||
    raw === "critical"
  ) {
    return raw;
  }
  return null;
}

function numericOrNull(raw: string | number | null): number | null {
  if (raw === null) return null;
  return typeof raw === "string" ? Number.parseFloat(raw) : raw;
}

export function mapRow(row: BugReportRow): BugReport {
  return {
    id: row.id,
    reportKind: row.report_kind as BugReportKind,
    source: row.source as BugReportSource,
    category: row.category,
    severity: row.severity as BugReportSeverity,
    title: row.title,
    description: row.description,
    status: row.status as BugReportStatus,
    uploadState: row.upload_state as BugReportUploadState,
    uploadAttemptCount: row.upload_attempt_count,
    nextUploadAt: toIsoOrNull(row.next_upload_at),
    lastUploadError: row.last_upload_error,
    remoteReportId: row.remote_report_id,
    uploadedAt: toIsoOrNull(row.uploaded_at),
    appVersion: row.app_version,
    osPlatform: row.os_platform,
    installId: row.install_id,
    correlationId: row.correlation_id,
    sessionId: row.session_id,
    missionId: row.mission_id,
    missionRunId: row.mission_run_id,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    protocolNamespace: row.protocol_namespace,
    compactJobId: row.compact_job_id,
    stopReason: row.stop_reason,
    runtimeStatus: row.runtime_status,
    contextPressureBand: pressureBandOrNull(row.context_pressure_band),
    contextPressureFraction: numericOrNull(row.context_pressure_fraction),
    checkpointGeneration: row.checkpoint_generation,
    postCompactBridgeActive: row.post_compact_bridge_active,
    redactionHardCount: row.redaction_hard_count,
    redactionMaskCount: row.redaction_mask_count,
    sanitizedContext: row.sanitized_context ?? {},
    attachments: row.attachments ?? [],
    retentionUntil: toIsoOrNull(row.retention_until),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
