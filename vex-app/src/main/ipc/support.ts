/**
 * vex.support.* — local-first support surfaces.
 *
 * `createBugReport` (Phase 1 contract):
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
 *
 * `openLogsFolder` (error-diagnostics plan D-FOLDER):
 *   - No renderer input. Main resolves `${userData}/logs` itself, applies
 *     the fs.realpath containment idiom (clone of
 *     onboarding/wallets/export.ts) so a symlink swap cannot redirect
 *     `shell.openPath` outside userData, then opens the RESOLVED path.
 *   - The renderer never sees a filesystem path — output is `{opened:true}`.
 */

import { shell } from "electron";
import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result, type VexError } from "@shared/ipc/result.js";
import {
  createBugReportInputSchema,
  createBugReportResultSchema,
  type CreateBugReportInput,
  type CreateBugReportResult,
} from "@shared/schemas/bug-reports.js";
import {
  openLogsFolderInputSchema,
  openLogsFolderResultSchema,
  type OpenLogsFolderResult,
} from "@shared/schemas/support.js";
import { registerHandler, type HandlerContext } from "./register-handler.js";
import { createBugReport } from "../support/bug-report-service.js";
import { log } from "../logger/index.js";
import { resolveContainedLogsDir } from "../support/logs-dir.js";

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

function openLogsFolderFailed(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "support",
    message: "Could not open the logs folder in the file manager.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

/**
 * Resolve the electron-log directory (`${userData}/logs`, creating it if
 * missing) to its real on-disk path and confirm it still sits strictly inside
 * the real userData directory after symlink resolution. Returns the resolved
 * real path — the handler MUST pass that (not the joined candidate) to
 * `shell.openPath` to close the symlink-swap TOCTOU window between
 * validation and open. Mirrors `resolveBackupDir` in
 * `onboarding/wallets/dialogs.ts`.
 */

function registerCreateBugReportHandler(): () => void {
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

function registerOpenLogsFolderHandler(): () => void {
  return registerHandler({
    channel: CH.support.openLogsFolder,
    domain: "support",
    inputSchema: openLogsFolderInputSchema,
    outputSchema: openLogsFolderResultSchema,
    handle: async (
      _input,
      ctx: HandlerContext,
    ): Promise<Result<OpenLogsFolderResult>> => {
      const resolved = await resolveContainedLogsDir();
      if (resolved === null) {
        log.warn(
          `[ipc:vex:support:openLogsFolder] logs dir failed containment correlationId=${ctx.requestId}`,
        );
        return err(openLogsFolderFailed(ctx.requestId));
      }
      // Pass the realpath-resolved candidate to shell.openPath so a symlink
      // swap between validation and open cannot redirect the open target.
      const errorMessage = await shell.openPath(resolved);
      if (errorMessage !== "") {
        log.error(
          `[ipc:vex:support:openLogsFolder] shell.openPath failed: ${errorMessage} correlationId=${ctx.requestId}`,
        );
        return err(openLogsFolderFailed(ctx.requestId));
      }
      return ok({ opened: true });
    },
  });
}

export function registerSupportHandler(): () => void {
  const teardowns = [
    registerCreateBugReportHandler(),
    registerOpenLogsFolderHandler(),
  ];
  return () => {
    for (const teardown of teardowns) teardown();
  };
}
