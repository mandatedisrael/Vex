/**
 * Bug-reports DB helper for vex-app's local `support` sink.
 *
 * vex-app deliberately uses its own pg connections so the GUI build stays
 * decoupled from the engine (`src/vex-agent`) module graph (mirrors the
 * pattern in `sessions-db.ts` and `dim-lock.ts`). The shared schema lives
 * in `src/vex-agent/db/migrations/019_bug_reports.sql` and is mirrored
 * into `vex-app/resources/migrations/` at build/dev time by
 * `vex-app/scripts/copy-migrations.mjs`.
 *
 * Connection lifecycle: each public function opens its own `pg.Client`
 * (single-shot) through `buildPoolConfig()` and closes it in `finally`. No
 * pool is kept around — these calls are infrequent, never on a hot path,
 * and the explicit lifecycle keeps connection leaks impossible to reach.
 *
 * Redaction is NOT applied here. Callers (the `support` service in
 * `../support/bug-report-service.ts`) MUST redact `description`,
 * `sanitized_context`, and `attachments` BEFORE calling `insertBugReport`.
 * The `redaction_*_count` columns are stamped to prove that contract was
 * upheld.
 */

import { Client, type ClientConfig } from "pg";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

export type BugReportKind = "manual" | "automatic";
export type BugReportSource = "user" | "renderer" | "main" | "agent" | "worker";
export type BugReportSeverity = "info" | "warning" | "error" | "critical";
export type BugReportStatus = "open" | "triaged" | "dismissed";
export type BugReportUploadState =
  | "not_configured"
  | "queued"
  | "uploading"
  | "uploaded"
  | "failed";
export type ContextPressureBand =
  | "normal"
  | "warning"
  | "barrier"
  | "critical";

export interface BugReport {
  readonly id: string;
  readonly reportKind: BugReportKind;
  readonly source: BugReportSource;
  readonly category: string;
  readonly severity: BugReportSeverity;
  readonly title: string;
  readonly description: string;
  readonly status: BugReportStatus;
  readonly uploadState: BugReportUploadState;
  readonly uploadAttemptCount: number;
  readonly nextUploadAt: string | null;
  readonly lastUploadError: string | null;
  readonly remoteReportId: string | null;
  readonly uploadedAt: string | null;
  readonly appVersion: string | null;
  readonly osPlatform: string | null;
  readonly installId: string | null;
  readonly correlationId: string | null;
  readonly sessionId: string | null;
  readonly missionId: string | null;
  readonly missionRunId: string | null;
  readonly subagentId: string | null;
  readonly toolName: string | null;
  readonly toolCallId: string | null;
  readonly protocolNamespace: string | null;
  readonly compactJobId: number | null;
  readonly stopReason: string | null;
  readonly runtimeStatus: string | null;
  readonly contextPressureBand: ContextPressureBand | null;
  readonly contextPressureFraction: number | null;
  readonly checkpointGeneration: number | null;
  readonly postCompactBridgeActive: boolean | null;
  readonly redactionHardCount: number;
  readonly redactionMaskCount: number;
  readonly sanitizedContext: Record<string, unknown>;
  readonly attachments: ReadonlyArray<unknown>;
  readonly retentionUntil: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BugReportInsert {
  readonly id: string;
  readonly reportKind: BugReportKind;
  readonly source: BugReportSource;
  readonly category: string;
  readonly severity: BugReportSeverity;
  readonly title: string;
  readonly description: string;
  readonly appVersion: string | null;
  readonly osPlatform: string | null;
  readonly installId: string | null;
  readonly correlationId: string | null;
  readonly sessionId: string | null;
  readonly missionId: string | null;
  readonly missionRunId: string | null;
  readonly subagentId: string | null;
  readonly toolName: string | null;
  readonly toolCallId: string | null;
  readonly protocolNamespace: string | null;
  readonly compactJobId: number | null;
  readonly stopReason: string | null;
  readonly runtimeStatus: string | null;
  readonly contextPressureBand: ContextPressureBand | null;
  readonly contextPressureFraction: number | null;
  readonly checkpointGeneration: number | null;
  readonly postCompactBridgeActive: boolean | null;
  readonly redactionHardCount: number;
  readonly redactionMaskCount: number;
  readonly sanitizedContext: Record<string, unknown>;
  readonly attachments: ReadonlyArray<unknown>;
  readonly retentionUntil: string | null;
}

interface BugReportRow {
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
  readonly subagent_id: string | null;
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

const BUG_REPORT_COLUMNS = `
  id, report_kind, source, category, severity, title, description, status,
  upload_state, upload_attempt_count, next_upload_at, last_upload_error,
  remote_report_id, uploaded_at,
  app_version, os_platform, install_id,
  correlation_id, session_id, mission_id, mission_run_id, subagent_id,
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

function mapRow(row: BugReportRow): BugReport {
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
    subagentId: row.subagent_id,
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

/**
 * Bug-reports DB unavailable. Distinct from a transient query failure —
 * thrown when compose hasn't materialised the password file yet, so the
 * support sink simply has nowhere to write. The service layer maps this
 * to `support.persist_failed` (retryable: true) at the IPC boundary.
 */
export class BugReportsDbUnavailableError extends Error {
  constructor() {
    super("Bug reports DB unavailable (compose state missing).");
    this.name = "BugReportsDbUnavailableError";
  }
}

async function withClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const cfg = await buildPoolConfig();
  if (cfg === null) {
    throw new BugReportsDbUnavailableError();
  }
  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[bug-reports-db] client.connect failed", cause);
    throw cause;
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[bug-reports-db] client.end failed (non-fatal)", cause);
    }
  }
}

export async function insertBugReport(input: BugReportInsert): Promise<BugReport> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `INSERT INTO bug_reports (
         id, report_kind, source, category, severity, title, description,
         app_version, os_platform, install_id,
         correlation_id, session_id, mission_id, mission_run_id, subagent_id,
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
         $11, $12, $13, $14, $15,
         $16, $17, $18, $19,
         $20, $21,
         $22, $23,
         $24, $25,
         $26, $27,
         $28::jsonb, $29::jsonb, $30
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
        input.subagentId,
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

export interface ListRecentArgs {
  readonly limit: number;
  readonly sinceCreatedAt?: string;
}

export async function listRecentBugReports(
  args: ListRecentArgs,
): Promise<BugReport[]> {
  const safeLimit = Math.max(1, Math.min(args.limit, 500));
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      args.sinceCreatedAt !== undefined
        ? `SELECT ${BUG_REPORT_COLUMNS}
           FROM bug_reports
           WHERE created_at >= $1
           ORDER BY created_at DESC
           LIMIT $2`
        : `SELECT ${BUG_REPORT_COLUMNS}
           FROM bug_reports
           ORDER BY created_at DESC
           LIMIT $1`,
      args.sinceCreatedAt !== undefined
        ? [args.sinceCreatedAt, safeLimit]
        : [safeLimit],
    );
    return result.rows.map(mapRow);
  });
}

export async function getBugReportById(id: string): Promise<BugReport | null> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `SELECT ${BUG_REPORT_COLUMNS} FROM bug_reports WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  });
}

/**
 * Phase 3 prep — invoked by the upload worker (not built yet) to record
 * one upload attempt. Owner-checked at the SQL level by id only because
 * Phase 3 will introduce a `locked_by` column at that time; for now the
 * single-instance lock on vex-app guarantees one writer.
 *
 * Always updates `updated_at = NOW()`. Sets `next_upload_at` to control
 * the retry backoff; setting it to NULL parks the report (e.g. terminal
 * failure or successful upload).
 */
export async function bumpUploadAttempt(
  id: string,
  args: {
    readonly state: BugReportUploadState;
    readonly error: string | null;
    readonly nextUploadAt: string | null;
    readonly remoteReportId?: string | null;
    readonly uploadedAt?: string | null;
  },
): Promise<BugReport | null> {
  return withClient(async (client) => {
    const result = await client.query<BugReportRow>(
      `UPDATE bug_reports
       SET upload_state          = $2,
           upload_attempt_count  = upload_attempt_count + 1,
           last_upload_error     = $3,
           next_upload_at        = $4,
           remote_report_id      = COALESCE($5, remote_report_id),
           uploaded_at           = COALESCE($6::timestamptz, uploaded_at),
           updated_at            = NOW()
       WHERE id = $1
       RETURNING ${BUG_REPORT_COLUMNS}`,
      [
        id,
        args.state,
        args.error,
        args.nextUploadAt,
        args.remoteReportId ?? null,
        args.uploadedAt ?? null,
      ],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  });
}
