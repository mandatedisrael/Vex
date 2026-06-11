/**
 * Presentational header + body for `ApprovalCard` (F3).
 *
 * Renders the approval title (`namespace:tool`), the risk + action stamps, the
 * reasoning preview, the critical-args well, and the inline error alert. Pure
 * presentation: it holds no state, owns no decision logic, and emits no events
 * — the two-step confirm gate and mutation wiring stay in `ApprovalCard`.
 * Testids, aria, and TEXT CONTENT are pinned by tests and stay verbatim; S3
 * restyled the chrome only (stamp grammar + recessed args well).
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
  /**
   * S5 — one-shot signed glint in the stamp area after a successful approve.
   * The ONLY light in the approvals flow; reject never sets it.
   */
  readonly signedGlint?: boolean;
}

export function ApprovalDetails({
  summary,
  titleId,
  namespace,
  toolName,
  criticalArgs,
  inlineError,
  signedGlint = false,
}: ApprovalDetailsProps): JSX.Element {
  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--vex-line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="truncate font-mono text-[13px] text-foreground"
          >
            Approval needed:{" "}
            <span className="font-mono">
              {namespace !== null ? `${namespace}:${toolName}` : toolName}
            </span>
          </h3>
        </div>
        {/* Stamp grammar — text content stays verbatim (tests pin it). */}
        {summary.riskLevel !== null ? (
          <span
            data-testid="risk-chip"
            className={`shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${riskChipClasses(
              summary.riskLevel,
            )}`}
          >
            {summary.riskLevel}
          </span>
        ) : null}
        {summary.actionKind !== null ? (
          <span
            data-testid="action-chip"
            className="shrink-0 rounded-[3px] border border-[var(--vex-line-strong)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)]"
          >
            {summary.actionKind}
          </span>
        ) : null}
        {/* The signed glint — plays once via stylesheet keyframes and ends
            transparent; unmounting early is fine (grace note, not contract). */}
        {signedGlint ? (
          <span
            aria-hidden
            data-vex-signed-glint=""
            className="vex-intro-glint h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--vex-accent-text)]"
          />
        ) : null}
      </header>
      <div className="space-y-3 px-4 py-3">
        {summary.reasoningPreview.trim().length > 0 ? (
          <p className="italic text-[var(--vex-text-2)]">
            {summary.reasoningPreview}
          </p>
        ) : null}
        {/* Critical args — recessed well: the facts being signed for. */}
        {criticalArgs !== null && Object.keys(criticalArgs).length > 0 ? (
          <dl
            data-testid="critical-args"
            className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 rounded-[6px] border border-[var(--vex-line)] bg-[var(--vex-surface-down)] px-3 py-2 font-mono text-[11px]"
          >
            {Object.entries(criticalArgs).map(([k, v]) => (
              // `display: contents` keeps the grid layout while giving each
              // pair a stable React key.
              <div key={k} className="contents">
                <dt className="uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
                  {k}
                </dt>
                <dd className="break-all text-[var(--vex-text-2)]">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {inlineError !== null ? (
          <p
            role="alert"
            className="rounded-[6px] border border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {inlineError}
          </p>
        ) : null}
      </div>
    </>
  );
}
