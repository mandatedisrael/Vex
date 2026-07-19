/**
 * MissionContractModal — the mission contract review/accept surface, hosted in
 * a top-layer native `<dialog>` (the MISSION RAIL's `PremiumBadge` opens it).
 *
 * This wraps the SAME state machine + hooks the inline `MissionContractCard`
 * uses (`useMissionDraft` + `useMissionDiff` + `useSessionPlan` →
 * `resolvePlanGate`, `useAcceptMissionContract`, `useSetAutoRetry`). The single
 * "Accept contract & plan" action lives in the DialogFooter — `shrink-0` and
 * pinned, so it can never be pushed below the fold the way the inline card's
 * footer was (that overflow is the bug this rail/modal redesign resolves).
 *
 * The body reuses the card's presentational `CardBody` + `AutoRetrySection`;
 * the footer reproduces the `CardFooter` accept logic (helper copy, plan-mode
 * gate, plan_missing block, accept-outcome notice) in the dialog's footer
 * surface.
 *
 * `planUpdatedAt` token wiring is preserved EXACTLY: the renderer reads the
 * reviewed plan's `updatedAt` via `plan.get` and echoes it back to
 * `mission.acceptContract` as the stale guard ONLY when an enabled, non-empty,
 * unaccepted plan exists. No plan CONTENT crosses any new boundary — the
 * markdown is already returned by `plan.get`; the modal only echoes the
 * timestamp. On a `plan_stale` outcome the modal shows an in-modal banner and
 * refetches the plan (the accept mutation does not invalidate it), then leaves
 * the Accept button in place for re-review.
 */

import { useEffect, useMemo } from "react";
import type { JSX } from "react";
import { assertNever, type Result } from "@shared/ipc/result.js";
import type {
  MissionAcceptContractResult,
  MissionDraftDto,
  MissionGetDiffResult,
} from "@shared/schemas/mission.js";
import type { PlanGetResult } from "@shared/schemas/session-plan.js";
import {
  useAcceptMissionContract,
  useMissionDiff,
  useMissionDraft,
  useSetAutoRetry,
} from "../../lib/api/mission.js";
import { useSessionPlan } from "../../lib/api/sessions.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import {
  AutoRetrySection,
  CardBody,
  type CardStateKind,
} from "./MissionContractCardSections.js";
import { PremiumBadge, type PremiumBadgeState } from "./PremiumBadge.js";

/**
 * Plan-mode gate for the unified accept step (Approach A). Mirrors the engine's
 * `enabled && !accepted` condition — identical to `MissionContractCard` so the
 * inline card and the modal derive the same gate from the same query.
 */
type PlanGate =
  | { readonly kind: "none" }
  | { readonly kind: "ready"; readonly planUpdatedAt: string }
  | { readonly kind: "missing" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed" };

type PlanReadState = "loading" | "failed" | "known";

function resolvePlanGate(plan: PlanGetResult | null, readState: PlanReadState): PlanGate {
  // Pending/failed plan read = the plan state is UNKNOWN. The engine would
  // reject an unsafe accept anyway, but the UI must not INVITE a knowingly
  // invalid action — both suppress acceptance (same rule as the rail badge
  // and the MissionControls review bar). They differ in the exit: loading
  // resolves itself; failed needs an explicit Retry (the failed Result sits
  // in the query cache as "successful" data, so nothing refetches on its
  // own while the modal stays mounted).
  if (readState === "loading") return { kind: "loading" };
  if (readState === "failed") return { kind: "failed" };
  if (plan === null || !plan.enabled || plan.accepted) return { kind: "none" };
  if (plan.planMd.length === 0) return { kind: "missing" };
  return { kind: "ready", planUpdatedAt: plan.updatedAt };
}

interface CardState {
  readonly kind: CardStateKind;
  readonly draft: MissionDraftDto;
  readonly currentHash: string | null;
}

export interface MissionContractModalProps {
  readonly sessionId: string;
  readonly permission: "full" | "restricted";
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

export function MissionContractModal({
  sessionId,
  permission,
  open,
  onOpenChange,
}: MissionContractModalProps): JSX.Element {
  const draftQuery = useMissionDraft(sessionId);
  const draft = readDraft(draftQuery.data);
  const diffQuery = useMissionDiff(sessionId, draft?.missionId ?? null);
  const diff = readDiff(diffQuery.data);
  const planQuery = useSessionPlan(sessionId);
  // isError FIRST: a rejected ipc invoke leaves data undefined forever —
  // reading only `data` would render "loading" with no way out.
  const planReadState: PlanReadState = planQuery.isError
    ? "failed"
    : planQuery.data === undefined
      ? "loading"
      : planQuery.data.ok
        ? "known"
        : "failed";
  const planGate = resolvePlanGate(readPlan(planQuery.data), planReadState);
  const accept = useAcceptMissionContract();
  const autoRetry = useSetAutoRetry();

  const state = useMemo<CardState | null>(() => {
    if (draft === null) return null;
    if (draft.status === "draft") {
      return { kind: "setup-needed", draft, currentHash: null };
    }
    if (diff === null) {
      return { kind: "setup-needed", draft, currentHash: null };
    }
    if (diff.isAccepted && !diff.isDirty) {
      return { kind: "accepted", draft, currentHash: null };
    }
    if (diff.isAccepted && diff.isDirty) {
      return { kind: "dirty-acceptance", draft, currentHash: diff.currentHash };
    }
    return { kind: "awaiting-acceptance", draft, currentHash: diff.currentHash };
  }, [draft, diff]);

  const onAccept = (hash: string): void => {
    accept.mutate(
      {
        sessionId,
        missionId: draft?.missionId ?? "",
        contractHash: hash,
        // Unified accept (Approach A): echo the reviewed plan's `updatedAt` as a
        // stale guard ONLY when an enabled, non-empty, unaccepted plan exists.
        // Plan-mode off / no plan → omitted → default single-accept payload.
        ...(planGate.kind === "ready"
          ? { planUpdatedAt: planGate.planUpdatedAt }
          : {}),
      },
      {
        // A successful accept closes the modal so the Start mission button it
        // points at is actually reachable. Every non-`accepted` outcome (and
        // any transport failure) keeps it open for the in-modal notice.
        onSuccess: (result) => {
          if (result.ok && result.data.outcome === "accepted") {
            onOpenChange(false);
          }
        },
      },
    );
  };

  const acceptOutcome = readAcceptOutcome(accept.data);
  // A rejected mutation (`isError`, no `data`) OR a resolved-but-failed Result
  // envelope (`ok: false`, a handled IPC/domain error) are both failure
  // surfaces — neither yields an `outcome`, so without this the user would see
  // nothing.
  const acceptErrored =
    accept.isError || (accept.data !== undefined && !accept.data.ok);
  const acceptNotice = acceptNoticeFor(acceptOutcome, acceptErrored);

  // plan_stale recovery: the accept mutation does NOT invalidate the plan
  // query, so refetch it here and keep the modal open with the Accept button
  // in place (in-modal banner via `acceptNotice` flags the re-review).
  //
  // Effect-driven (NOT render-phase): keyed on `accept.data` — TanStack hands
  // back a fresh result object on every settle, so this fires exactly ONCE per
  // accept attempt that resolves to `plan_stale`, never on subsequent re-renders
  // (the previous render-phase `refetch()` looped: each completed refetch
  // re-rendered while `acceptOutcome` was still `plan_stale`, re-triggering it).
  const planRefetch = planQuery.refetch;
  useEffect(() => {
    if (acceptOutcome === "plan_stale") {
      void planRefetch();
    }
    // `accept.data` is intentionally the trigger (new identity per settle); the
    // derived `acceptOutcome` would not change identity across a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accept.data, planRefetch]);

  const title = state?.draft.title?.trim() || "Mission contract";
  const badgeState = toBadgeState(state?.kind, acceptOutcome, planGate);
  const badgeShimmer = badgeState === "ready";

  const showAutoRetry = permission === "full" && state !== null;
  const autoRetryEnabled = state?.draft.constraints.autoRetryEnabled === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Brand chrome (raised ink panel, hairline, black/70 no-blur backdrop)
       * is the Dialog base since the rebrand — only width is per-modal. */}
      <DialogContent
        data-vex-area="mission-contract-modal"
        className="max-w-lg"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-[var(--vex-line)]">
          {/* Mission titles are authored content, not chrome — they speak the
           * display register (Archivo), not the base mono stamp. */}
          <DialogTitle className="truncate font-display text-base font-bold normal-case tracking-[-0.01em]">
            {title}
          </DialogTitle>
          {/* Status marker only — the modal is already open, so this is a
           * non-interactive `<span>` (no dead focus target), not the rail's
           * clickable badge. */}
          <span data-vex-state={badgeState} className="shrink-0">
            <PremiumBadge
              label="Mission"
              state={badgeState}
              shimmer={badgeShimmer}
              interactive={false}
            />
          </span>
        </DialogHeader>

        <DialogBody>
          {state === null ? (
            <p className="text-sm text-[var(--vex-text-3)]">
              Loading the mission contract…
            </p>
          ) : (
            <>
              <div className="-mx-6 -my-5">
                <CardBody draft={state.draft} />
                {showAutoRetry ? (
                  <AutoRetrySection
                    enabled={autoRetryEnabled}
                    pending={autoRetry.isPending}
                    onToggle={(next) =>
                      autoRetry.mutate({
                        sessionId,
                        missionId: state.draft.missionId,
                        enabled: next,
                      })
                    }
                  />
                ) : null}
              </div>
            </>
          )}
        </DialogBody>

        <FooterAction
          state={state}
          pending={accept.isPending}
          onAccept={onAccept}
          planGate={planGate}
          onPlanRetry={() => void planQuery.refetch()}
          planRetryPending={planQuery.isFetching}
          notice={acceptNotice}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FooterActionProps {
  readonly state: CardState | null;
  readonly pending: boolean;
  readonly onAccept: (hash: string) => void;
  readonly planGate: PlanGate;
  /** Refetches the plan read after a failed Result — see the `failed` gate. */
  readonly onPlanRetry: () => void;
  /** True while a refetch is in flight — the Retry button disables itself. */
  readonly planRetryPending: boolean;
  readonly notice: string | null;
}

/**
 * Reproduces `CardFooter`'s accept logic (helper copy, plan-mode label, the
 * plan_missing block, the accept notice) inside the dialog's pinned footer.
 * Kept here rather than reusing `CardFooter` so the action sits on the
 * DialogFooter surface (shrink-0, sticky) — the whole point of the move.
 */
function FooterAction({
  state,
  pending,
  onAccept,
  planGate,
  onPlanRetry,
  planRetryPending,
  notice,
}: FooterActionProps): JSX.Element | null {
  if (state === null) return null;
  const { kind, currentHash } = state;

  if (kind === "setup-needed") {
    return (
      <DialogFooter className="justify-start border-[var(--vex-line)] text-xs text-[var(--vex-text-3)]">
        Add a goal, constraints, and stop conditions to enable Accept.
      </DialogFooter>
    );
  }
  if (kind === "accepted") {
    return (
      <DialogFooter className="justify-start border-[var(--vex-line)] text-xs text-[var(--vex-text-3)]">
        Use the{" "}
        <span className="text-[var(--vex-accent-text)]">Start mission</span>{" "}
        button to dispatch.
      </DialogFooter>
    );
  }
  if (currentHash === null) return null;

  // Plan state not yet known — block accept: the UI must never present an
  // action the engine is known to reject right now.
  if (planGate.kind === "loading") {
    return (
      <DialogFooter className="justify-start border-[var(--vex-line)]">
        <p
          className="text-xs text-warning"
          role="alert"
          data-vex-state="plan-unknown"
        >
          Plan status is loading. Accepting is unavailable until it is known.
        </p>
      </DialogFooter>
    );
  }
  // Failed read: the err Result sits in the query cache as data, so nothing
  // refetches by itself while the modal stays mounted — without an explicit
  // Retry the user would be stranded here.
  if (planGate.kind === "failed") {
    return (
      <DialogFooter className="justify-between border-[var(--vex-line)]">
        <p
          className="text-xs text-warning"
          role="alert"
          data-vex-state="plan-failed"
        >
          Plan status could not be read. Accepting is unavailable until it is.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={planRetryPending}
          onClick={() => void onPlanRetry()}
        >
          Retry
        </Button>
      </DialogFooter>
    );
  }

  // Plan-mode ON but nothing authored — block accept and prompt to write a plan
  // first (matches the engine `plan_missing`).
  if (planGate.kind === "missing") {
    return (
      <DialogFooter className="justify-start border-[var(--vex-line)]">
        <p
          className="text-xs text-warning"
          role="alert"
          data-vex-state="plan-missing"
        >
          Plan mode is on, but no action plan has been authored yet. Ask Vex to
          write the plan, then accept the contract and plan together.
        </p>
      </DialogFooter>
    );
  }

  const isDirty = kind === "dirty-acceptance";
  const unified = planGate.kind === "ready";
  const helperText = unified
    ? "Accepting locks the contract AND the action plan for this run."
    : isDirty
      ? "Re-accept to bring the runtime back in sync with the draft."
      : "Accepting locks the contract for this mission run.";
  const acceptLabel = pending
    ? "Accepting…"
    : unified
      ? "Accept contract & plan"
      : isDirty
        ? "Accept new contract"
        : "Accept contract";

  return (
    <DialogFooter className="flex-col items-stretch gap-2 border-[var(--vex-line)] sm:flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--vex-text-3)]">{helperText}</span>
        {/* THE single primary action — filled cobalt pill (Button default). */}
        <Button
          type="button"
          size="sm"
          onClick={() => onAccept(currentHash)}
          disabled={pending}
          data-vex-action="accept-contract"
        >
          {acceptLabel}
        </Button>
      </div>
      {notice !== null ? (
        <p
          role="alert"
          data-vex-state="plan-accept-notice"
          className="w-full text-xs text-warning"
        >
          {notice}
        </p>
      ) : null}
    </DialogFooter>
  );
}

/**
 * Map the contract state + accept outcome to the rail badge state. A transient
 * `plan_stale` outcome overrides to "stale" so the user sees the review-again
 * signal even though the underlying contract diff is still `awaiting`.
 */
function toBadgeState(
  kind: CardStateKind | undefined,
  acceptOutcome: MissionAcceptContractResult["outcome"] | null,
  planGate: PlanGate,
): PremiumBadgeState {
  if (acceptOutcome === "plan_stale") return "stale";
  switch (kind) {
    case undefined:
    case "setup-needed":
      return "preparing";
    case "accepted":
      return "accepted";
    case "dirty-acceptance":
      return "stale";
    case "awaiting-acceptance":
      // The header must never contradict the footer: while the plan is
      // loading/failed/empty the footer blocks acceptance, so the badge says
      // Preparing (same semantics as the Rail badge and the Controls bar).
      return planGate.kind === "loading" || planGate.kind === "failed" || planGate.kind === "missing"
        ? "preparing"
        : "ready";
  }
}

function readPlan(
  data: Result<PlanGetResult> | undefined,
): PlanGetResult | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readAcceptOutcome(
  data: Result<MissionAcceptContractResult> | undefined,
): MissionAcceptContractResult["outcome"] | null {
  if (!data || !data.ok) return null;
  return data.data.outcome;
}

/**
 * Map a `mission.acceptContract` attempt to a user-facing notice.
 *
 * Two failure surfaces feed this:
 *   - a resolved non-success `outcome` (handled IPC Result — the mutation
 *     "succeeded" at the transport level but the engine refused), and
 *   - a thrown/rejected mutation (`isError` — transport/IPC failure, where
 *     `accept.data` is absent).
 *
 * `plan_stale` / `plan_missing` keep their specific recovery copy; every other
 * non-success outcome maps to a generic "Couldn't accept: <reason>" so the user
 * never clicks Accept and sees nothing (the silent-failure bug). `accepted`
 * returns null (the diff query refetch reflects success).
 */
function acceptNoticeFor(
  outcome: MissionAcceptContractResult["outcome"] | null,
  isError: boolean,
): string | null {
  if (outcome !== null) return outcomeNotice(outcome);
  // No resolved outcome but the mutation rejected → transport/IPC failure.
  if (isError) {
    return "Couldn't accept the contract — something went wrong. Try again.";
  }
  return null;
}

function outcomeNotice(
  outcome: MissionAcceptContractResult["outcome"],
): string | null {
  switch (outcome) {
    case "accepted":
      return null;
    case "plan_stale":
      return "Plan changed — review again before accepting.";
    case "plan_missing":
      return "No plan authored yet — ask Vex to write a plan first.";
    case "mission_not_found":
      return "Couldn't accept: this mission no longer exists. Refresh and try again.";
    case "session_mismatch":
      return "Couldn't accept: this contract belongs to a different session.";
    case "hash_mismatch":
      return "Couldn't accept: the contract changed since you reviewed it. Review the current contract and accept again.";
    case "status_blocked":
      return "Couldn't accept: this mission can no longer be accepted in its current state.";
    case "run_active":
      return "Couldn't accept: a run is already active for this mission.";
    default:
      return assertNever(outcome);
  }
}

function readDraft(
  data: Result<MissionDraftDto | null> | undefined,
): MissionDraftDto | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readDiff(
  data: Result<MissionGetDiffResult> | undefined,
): Extract<MissionGetDiffResult, { outcome: "ready" }> | null {
  if (!data || !data.ok) return null;
  if (data.data.outcome !== "ready") return null;
  return data.data;
}
