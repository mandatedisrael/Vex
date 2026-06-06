/**
 * Presentational header + body for `ApprovalCard` (F3).
 *
 * Renders the approval title (`namespace:tool`), the risk + action chips, the
 * reasoning preview, the critical-args grid, and the inline error alert. Pure
 * presentation: it holds no state, owns no decision logic, and emits no events
 * — the two-step confirm gate and mutation wiring stay in `ApprovalCard`. JSX
 * moved VERBATIM (including testids, aria, and class strings) so rendering and
 * accessibility are unchanged.
 */

import type { JSX } from "react";
import type {
  ApprovalPreview,
  ApprovalSummaryDto,
} from "@shared/schemas/approvals.js";
import { riskChipClasses } from "./risk.js";

export interface ApprovalDetailsProps {
  readonly summary: ApprovalSummaryDto;
  readonly titleId: string;
  readonly namespace: string | null;
  readonly toolName: string;
  /** `preview.criticalArgs` (JSON-safe scalars) or null — same shape the parent reads. */
  readonly criticalArgs: ApprovalPreview["criticalArgs"] | null;
  readonly inlineError: string | null;
}

export function ApprovalDetails({
  summary,
  titleId,
  namespace,
  toolName,
  criticalArgs,
  inlineError,
}: ApprovalDetailsProps): JSX.Element {
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="truncate font-medium text-[var(--color-text-primary)]"
          >
            Approval needed:{" "}
            <span className="font-mono">
              {namespace !== null ? `${namespace}:${toolName}` : toolName}
            </span>
          </h3>
        </div>
        {summary.riskLevel !== null ? (
          <span
            data-testid="risk-chip"
            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${riskChipClasses(
              summary.riskLevel,
            )}`}
          >
            {summary.riskLevel}
          </span>
        ) : null}
        {summary.actionKind !== null ? (
          <span
            data-testid="action-chip"
            className="shrink-0 rounded-md border border-white/[0.10] px-2 py-0.5 text-xs uppercase tracking-wide"
          >
            {summary.actionKind}
          </span>
        ) : null}
      </header>
      <div className="space-y-3 px-4 py-3">
        {summary.reasoningPreview.trim().length > 0 ? (
          <p className="italic text-[var(--color-text-secondary)]">
            {summary.reasoningPreview}
          </p>
        ) : null}
        {criticalArgs !== null && Object.keys(criticalArgs).length > 0 ? (
          <dl
            data-testid="critical-args"
            className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
          >
            {Object.entries(criticalArgs).map(([k, v]) => (
              // `display: contents` keeps the grid layout while giving each
              // pair a stable React key.
              <div key={k} className="contents">
                <dt className="uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {k}
                </dt>
                <dd className="break-all font-mono">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {inlineError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {inlineError}
          </p>
        ) : null}
      </div>
    </>
  );
}
