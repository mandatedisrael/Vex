/**
 * Inline approval card (F3 — restricted-mode unblock).
 *
 * Shown by `ApprovalsRegion` between the transcript and the composer when the
 * agent's mutating tool call paused the run at `paused_approval` and the
 * backend enqueued an approval. Backend is live (puzzle-5 phase-3):
 * `useApprove`/`useReject` → `window.vex.approvals.{approve,reject}` →
 * `prepareApprove`/`prepareReject` → background `runResumeAfterDecision`.
 *
 * UX (per vex-ui-ux-quality + vex-provider-hot-wallet skills):
 *   - Default focus on Reject (least destructive) when this card is the
 *     FIRST newly-appearing one (parent decides via `focusOnMount`).
 *   - Two-step confirm for high-risk: `riskLevel ∈ {high,critical}` OR
 *     `actionKind ∈ {destructive,user_wallet_broadcast}`. First click arms,
 *     second click within CONFIRM_RESET_MS fires; timeout resets.
 *   - On success: invalidate pending / history (prefix) / messages
 *     (transcript) / runtime — the engine resume can flip status + write
 *     new transcript rows.
 *   - `useApprove`/`useReject` already use `retry: false`; we DO NOT auto-
 *     retry a dangerous action.
 *   - `Result.ok === false` surfaces as an inline error (TanStack `isError`
 *     does not catch application-level `Result` failures — Codex F3 #1).
 *   - `aria-live="polite"` so screen readers announce the card without
 *     stealing focus from existing content.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApprovalSummaryDto } from "@shared/schemas/approvals.js";
import { useApprove, useReject } from "../../lib/api/approvals.js";
import {
  approvalsKeys,
  messagesKeys,
  runtimeKeys,
} from "../../lib/api/queryKeys.js";
import { isHighRisk as classifyHighRisk } from "./ApprovalCard/risk.js";
import { ApprovalDetails } from "./ApprovalCard/ApprovalDetails.js";
import { ApprovalDecisionActions } from "./ApprovalCard/ApprovalDecisionActions.js";

const CONFIRM_RESET_MS = 4_000;

export interface ApprovalCardProps {
  readonly summary: ApprovalSummaryDto;
  readonly sessionId: string;
  /**
   * When true on initial mount, focus the Reject button. Parent computes this
   * for the FIRST newly-appearing card to honour the UX skill's "default focus
   * on least destructive" without stealing focus on every refetch.
   */
  readonly focusOnMount: boolean;
}

export function ApprovalCard({
  summary,
  sessionId,
  focusOnMount,
}: ApprovalCardProps): JSX.Element {
  const queryClient = useQueryClient();
  const approve = useApprove();
  const reject = useReject();
  const rejectRef = useRef<HTMLButtonElement | null>(null);

  const isHighRisk = useMemo(
    () => classifyHighRisk(summary),
    // Same inputs as the original inline classifier — recompute only when the
    // risk-bearing fields change, not on every `summary` identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.riskLevel, summary.actionKind],
  );

  // Two-step confirm for high-risk. First click arms; second within
  // CONFIRM_RESET_MS fires. Switching buttons (or timeout) resets.
  const [armedAction, setArmedAction] = useState<"approve" | "reject" | null>(
    null,
  );
  useEffect(() => {
    if (armedAction === null) return;
    const t = setTimeout(() => setArmedAction(null), CONFIRM_RESET_MS);
    return () => clearTimeout(t);
  }, [armedAction]);

  // Focus Reject only ONCE per Codex constraint #3 — empty deps so a refetch
  // that rerenders this card never refocuses (other components may have stolen
  // focus deliberately, e.g. user is typing in the composer).
  useEffect(() => {
    if (focusOnMount) rejectRef.current?.focus();
    // Intentionally empty deps — first-mount focus only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [inlineError, setInlineError] = useState<string | null>(null);
  const inFlight = approve.isPending || reject.isPending;

  const invalidateOnResolve = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: approvalsKeys.pending(sessionId),
      }),
      // history prefix (limit varies): match every history query for this session.
      queryClient.invalidateQueries({
        queryKey: ["approvals", "history", sessionId] as const,
      }),
      queryClient.invalidateQueries({
        queryKey: messagesKeys.forSession(sessionId),
      }),
      queryClient.invalidateQueries({
        queryKey: runtimeKeys.state(sessionId),
      }),
    ]);
  };

  const fireApprove = (): void => {
    setInlineError(null);
    approve.mutate(
      { id: summary.id },
      {
        onSuccess: async (result) => {
          if (result.ok) {
            setArmedAction(null);
            await invalidateOnResolve();
          } else {
            setInlineError(result.error.message);
          }
        },
        onError: (e) => setInlineError(e.message),
      },
    );
  };

  const fireReject = (): void => {
    setInlineError(null);
    reject.mutate(
      { id: summary.id },
      {
        onSuccess: async (result) => {
          if (result.ok) {
            setArmedAction(null);
            await invalidateOnResolve();
          } else {
            setInlineError(result.error.message);
          }
        },
        onError: (e) => setInlineError(e.message),
      },
    );
  };

  const onApproveClick = (): void => {
    if (inFlight) return;
    if (isHighRisk && armedAction !== "approve") {
      setArmedAction("approve");
      return;
    }
    fireApprove();
  };
  const onRejectClick = (): void => {
    if (inFlight) return;
    if (isHighRisk && armedAction !== "reject") {
      setArmedAction("reject");
      return;
    }
    fireReject();
  };

  const titleId = `approval-card-${summary.id}-title`;
  const previewTool = summary.preview?.toolName ?? null;
  const namespace = summary.preview?.namespace ?? null;
  const toolName = previewTool ?? summary.toolName ?? "(unknown tool)";
  const criticalArgs = summary.preview?.criticalArgs ?? null;

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      aria-live="polite"
      data-vex-area="approval-card"
      data-approval-id={summary.id}
      className="mt-3 overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.035] text-sm text-[var(--color-text-secondary)] backdrop-blur-xl"
    >
      <ApprovalDetails
        summary={summary}
        titleId={titleId}
        namespace={namespace}
        toolName={toolName}
        criticalArgs={criticalArgs}
        inlineError={inlineError}
      />
      <ApprovalDecisionActions
        isHighRisk={isHighRisk}
        armedAction={armedAction}
        inFlight={inFlight}
        rejectRef={rejectRef}
        onReject={onRejectClick}
        onApprove={onApproveClick}
      />
    </section>
  );
}
