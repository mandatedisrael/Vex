/**
 * Public type/DTO surface for the bug-reports DB repository.
 *
 * Single-sourced here so the `BugReport*` unions, the `BugReport` /
 * `BugReportInsert` shapes, and `ListRecentArgs` cannot drift across the
 * `create` / `read` / `upload-attempt` consumers (and the IPC + service
 * layers that import them through the façade).
 */

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

export interface ListRecentArgs {
  readonly limit: number;
  readonly sinceCreatedAt?: string;
}
