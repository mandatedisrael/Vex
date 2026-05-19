/**
 * Bug-report transport — Phase 1 no-op stub.
 *
 * Phase 3 will swap in an HTTPS uploader (separate consent, distinct from
 * Sentry telemetry consent). Until then, every report parks in `upload_state
 * = "not_configured"` and the service layer never schedules a retry.
 *
 * The interface is deliberately tiny so it can be replaced without touching
 * the service layer or the IPC handler.
 */

import type { BugReportUploadState } from "../database/bug-reports-db.js";

export interface BugReportTransport {
  /**
   * Enqueue a freshly-persisted report for upload. The returned
   * `uploadState` is stamped onto the IPC response so the renderer can
   * surface "saved locally" vs "saved + queued for upload" later.
   *
   * Implementations MUST NOT throw — failures should resolve to a sensible
   * `uploadState` ("failed" or "not_configured") so the service layer
   * doesn't surface persistence errors for transport faults.
   */
  enqueue(reportId: string): Promise<{ readonly uploadState: BugReportUploadState }>;
}

export const noopBugReportTransport: BugReportTransport = {
  async enqueue(): Promise<{ readonly uploadState: BugReportUploadState }> {
    return { uploadState: "not_configured" };
  },
};
