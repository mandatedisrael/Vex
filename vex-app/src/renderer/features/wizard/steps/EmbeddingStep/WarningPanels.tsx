/**
 * EmbeddingStep server-error warning panels — extracted VERBATIM from
 * `EmbeddingStep.tsx` (god-file split); zero behavior change.
 *
 * Error rendering is specialised by VexErrorCode:
 *   - embedding.dim_locked → warning card with the existing/target row
 *     count + "memory unavailable" guidance.
 *   - embedding.db_unavailable → retry card with hint to verify the
 *     System Check screen first.
 */

import type { JSX } from "react";
import type { ServerError } from "./form.js";

export interface EmbeddingWarningPanelsProps {
  readonly isDimLocked: boolean;
  readonly isDbDown: boolean;
  readonly serverError: ServerError | null;
}

export function EmbeddingWarningPanels({
  isDimLocked,
  isDbDown,
  serverError,
}: EmbeddingWarningPanelsProps): JSX.Element {
  return (
    <>
      {isDimLocked && serverError?.details ? (
        <div
          role="alert"
          data-vex-embedding-warning="dim-locked"
          className="rounded-md border border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] p-4 text-sm text-[var(--color-danger)]"
        >
          <strong className="block font-semibold">Dim change blocked.</strong>
          <p className="mt-1">
            {serverError.details.existingRowCount} existing long-term memory
            entries use a different embedding dimension. Changing to
            dim={serverError.details.targetDim} would make them
            unavailable.
          </p>
          <p className="mt-2 text-xs">
            Safe path: export your memory first, wipe
            <code className="mx-1">knowledge_entries</code>, then change
            dim and re-import. (Phase 2 GUI for this.)
          </p>
        </div>
      ) : null}
      {isDbDown ? (
        <div
          role="alert"
          data-vex-embedding-warning="db-unavailable"
          className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] p-4 text-sm text-[var(--color-warning)]"
        >
          <strong className="block font-semibold">
            Database unavailable.
          </strong>
          <p className="mt-1">{serverError?.message}</p>
          <p className="mt-2 text-xs">
            Verify Docker services are running, then retry.
          </p>
        </div>
      ) : null}
    </>
  );
}
