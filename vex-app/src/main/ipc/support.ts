/**
 * vex.support.createBugReport — local-first bug report sink.
 *
 * Phase 1 contract:
 *   - Renderer-supplied input passes through preload Zod, then main-side
 *     Zod via `registerHandler`.
 *   - Service layer applies composite redaction and persists to
 *     `bug_reports` via `bug-reports-db`.
 *   - No consent gating — local persistence is user-controlled data on
 *     their disk. Sentry consent (Phase 1) and upload consent (Phase 3)
 *     are distinct preferences.
 *   - Returns `Result<{ reportId, recorded, uploadState }>`. `recorded:false`
 *     would surface a soft persistence path (none today), so it is always
 *     `true` on the success path.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result, type VexError } from "@shared/ipc/result.js";
import {
  createBugReportInputSchema,
  createBugReportResultSchema,
  type CreateBugReportInput,
  type CreateBugReportResult,
} from "@shared/schemas/bug-reports.js";
import { registerHandler, type HandlerContext } from "./register-handler.js";
import { createBugReport } from "../support/bug-report-service.js";
import { log } from "../logger/index.js";

function persistFailed(correlationId: string): VexError {
  return {
    code: "support.persist_failed",
    domain: "support",
    message:
      "Could not record the bug report locally. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

export function registerSupportHandler(): () => void {
  return registerHandler({
    channel: CH.support.createBugReport,
    domain: "support",
    inputSchema: createBugReportInputSchema,
    outputSchema: createBugReportResultSchema,
    handle: async (
      input: CreateBugReportInput,
      ctx: HandlerContext,
    ): Promise<Result<CreateBugReportResult>> => {
      try {
        const created = await createBugReport({
          ...input,
          correlationIdFromIpc: ctx.requestId,
        });
        return ok({
          reportId: created.reportId,
          recorded: created.recorded,
          uploadState: created.uploadState,
        });
      } catch (cause) {
        // log.error already runs redactArgs — safe to pass `cause`.
        log.error("[support:createBugReport] persistence failed", cause);
        return err(persistFailed(ctx.requestId));
      }
    },
  });
}
