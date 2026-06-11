import type { Result } from "../../../ipc/result.js";
import type {
  CreateBugReportInput,
  CreateBugReportResult,
} from "../../../schemas/bug-reports.js";
import type { OpenLogsFolderResult } from "../../../schemas/support.js";

/**
 * Local-first bug report sink (Phase 1). Persists to the local
 * `bug_reports` table after redaction. Distinct from Sentry telemetry —
 * this path runs without consent because the data stays on the user's
 * disk. Phase 3 will add an opt-in upload path on top of the same table.
 *
 * `openLogsFolder` (error-diagnostics phase D-FOLDER) opens the
 * electron-log directory in the OS file manager. No input, no path in the
 * result — main resolves and contains the path itself.
 */
export interface SupportBridge {
  readonly createBugReport: (
    input: CreateBugReportInput
  ) => Promise<Result<CreateBugReportResult>>;
  readonly openLogsFolder: () => Promise<Result<OpenLogsFolderResult>>;
}
