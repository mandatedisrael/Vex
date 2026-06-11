/**
 * vex-app shared schemas for the `support.openLogsFolder` IPC surface
 * (error-diagnostics plan D-FOLDER).
 *
 * The bug-report half of the support domain lives in `bug-reports.ts`
 * (re-exported from `@vex-lib/diagnostics/bug-report-schema`); this file owns
 * the app-local "open the electron-log folder" contract. No input — main
 * resolves the path itself (`${userData}/logs`); the renderer never supplies
 * or receives a filesystem path.
 */

import { z } from "zod";

export const openLogsFolderInputSchema = z.object({}).strict();
export type OpenLogsFolderInput = z.infer<typeof openLogsFolderInputSchema>;

export const openLogsFolderResultSchema = z
  .object({ opened: z.literal(true) })
  .strict();
export type OpenLogsFolderResult = z.infer<typeof openLogsFolderResultSchema>;
