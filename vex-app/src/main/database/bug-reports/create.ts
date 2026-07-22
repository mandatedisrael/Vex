/**
 * Bug-report insert.
 *
 * Redaction is NOT applied here. Callers (the `support` service in
 * `../../support/bug-report-service.ts`) MUST redact `description`,
 * `sanitized_context`, and `attachments` BEFORE calling `insertBugReport`.
 * The `redaction_*_count` columns are stamped to prove that contract was
 * upheld.
 */

import { withClient } from "./connection.js";
import { BUG_REPORT_COLUMNS, mapRow, type BugReportRow } from "./mappers.js";
import type { BugReport, BugReportInsert } from "./types.js";

export async function insertBugReport(input: BugReportInsert): Promise<BugReport> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `INSERT INTO bug_reports (
         id, report_kind, source, category, severity, title, description,
         app_version, os_platform, install_id,
         correlation_id, session_id, mission_id, mission_run_id,
         tool_name, tool_call_id, protocol_namespace, compact_job_id,
         stop_reason, runtime_status,
         context_pressure_band, context_pressure_fraction,
         checkpoint_generation, post_compact_bridge_active,
         redaction_hard_count, redaction_mask_count,
         sanitized_context, attachments, retention_until
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16, $17, $18,
         $19, $20,
         $21, $22,
         $23, $24,
         $25, $26,
         $27::jsonb, $28::jsonb, $29
       )
       RETURNING ${BUG_REPORT_COLUMNS}`,
      [
        input.id,
        input.reportKind,
        input.source,
        input.category,
        input.severity,
        input.title,
        input.description,
        input.appVersion,
        input.osPlatform,
        input.installId,
        input.correlationId,
        input.sessionId,
        input.missionId,
        input.missionRunId,
        input.toolName,
        input.toolCallId,
        input.protocolNamespace,
        input.compactJobId,
        input.stopReason,
        input.runtimeStatus,
        input.contextPressureBand,
        input.contextPressureFraction,
        input.checkpointGeneration,
        input.postCompactBridgeActive,
        input.redactionHardCount,
        input.redactionMaskCount,
        JSON.stringify(input.sanitizedContext),
        JSON.stringify(input.attachments),
        input.retentionUntil,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`insertBugReport: RETURNING produced no row for id=${input.id}`);
    }
    return mapRow(row);
  });
}
