/**
 * vex-app shared schemas for the `support` IPC surface.
 *
 * Re-exports the canonical Zod schemas from `@vex-lib/diagnostics/bug-report-schema`
 * so renderer (which cannot reach into `src/vex-agent/`) and main can both
 * reference one source of truth.
 *
 * The `@vex-lib` alias is configured in:
 *   - vex-app/tsconfig.shared.json
 *   - vex-app/tsconfig.main.json
 *   - vex-app/tsconfig.renderer.json
 *   - vex-app/vite.renderer.config.ts
 *
 * If a future Zod ABI mismatch between root and vex-app forces it, this
 * file can be replaced by a direct copy of the schemas without touching
 * any caller (channels.ts, preload, main handler, renderer dialog) —
 * they all import from this re-export module.
 */

export {
  SUPPORT_CATEGORY_REGEX,
  MANUAL_CATEGORIES,
  KNOWN_AUTOMATIC_CATEGORIES,
  bugReportCategorySchema,
  bugReportSeveritySchema,
  bugReportReportKindSchema,
  bugReportSourceSchema,
  bugReportUploadStateSchema,
  bugReportRefsSchema,
  createBugReportInputSchema,
  createBugReportResultSchema,
  type ManualCategory,
  type CreateBugReportInput,
  type CreateBugReportResult,
} from "@vex-lib/diagnostics/bug-report-schema.js";
