/**
 * MissionControls — the mission control surface that replaces the mission-*
 * slash commands. A single strip mounted above the composer for mission
 * sessions, the sole owner of runtime-gated mission controls:
 *
 *  - ACTIVE RUN → a status-gated toolbar:
 *      Continue (paused_wake/paused_user), Recover (paused_error),
 *      Edit (any status except paused_approval), Stop (always).
 *  - NO ACTIVE RUN + accepted/ready contract → a "Start mission" key
 *    (accent-hairline, S3) → mission.start.
 *  - NO ACTIVE RUN + a terminal accepted mission (the renew source) → a
 *    "Renew mission" button → mission.renew (clones it into a fresh draft).
 *  - NO ACTIVE RUN + a contract pending acceptance (any non-accepted-clean
 *    draft) → a standing muted-warn notice: on-chain actions are blocked by
 *    the runtime gate until the user accepts the contract and starts the run.
 *
 * The render gate keys off `runtime` ALONE — never the draft. A started
 * mission flips its row past `ready` (commit-start → `running`; terminal on
 * finalize), so `getDraft` returns null for the entire active/terminal run;
 * gating the toolbar on a draft hid it for every active run. Start reads the
 * draft, Renew reads the renew-source query — both AFTER the runtime gate.
 *
 * Every control surfaces refusal outcomes (the backend returns `ok:true`
 * classified outcomes like not_accepted / lease_busy / blocked_terminal), not
 * just transport errors, so a race never silently does nothing. Buttons are
 * disabled while any control mutation is in flight OR a control request is
 * already pending (runtime.pendingControlKind), preventing double-fire.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";
import { assertNever, type Result } from "@shared/ipc/result.js";
import type {
  MissionDraftDto,
  MissionGetDiffResult,
  MissionGetRenewableSourceResult,
  MissionRenewResult,
} from "@shared/schemas/mission.js";
import type { RuntimeStateDto } from "@shared/schemas/runtime.js";
import {
  useEditMission,
  useMissionContinue,
  useMissionDiff,
  useMissionDraft,
  useMissionLiveSync,
  useMissionRenew,
  useMissionRetry,
  useMissionStart,
  useMissionStop,
  useRenewableMissionSource,
} from "../../lib/api/mission.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
import { useIsChatSubmitting } from "../../lib/api/chat.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";

/**
 * Primary mission action (Start/Renew) — the landing's solid cobalt CTA:
 * full-width mono-uppercase pill, hover is a color change only (never a
 * glow or gradient).
 */
const PRIMARY_KEY =
  "flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[var(--vex-accent)] font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--vex-accent-contrast)] transition-colors hover:bg-[var(--vex-accent-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Pre-accept review action — same geometry as PRIMARY_KEY but accent-OUTLINED,
 * not filled: the solid accent fill stays reserved for the one commitment
 * action of each stage (Start/Renew here, Accept inside the modal). The
 * outlined→solid progression is deliberate feedback that accepting advanced
 * the mission a stage.
 */
const REVIEW_KEY =
  "flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[var(--vex-accent)] font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--vex-accent-text)] transition-colors hover:bg-[color-mix(in_oklab,var(--vex-accent)_12%,transparent)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export interface MissionControlsProps {
  readonly sessionId: string;
}

type ControlNotice = { readonly tone: "error"; readonly text: string } | null;

/** Outcomes that mean the control succeeded — no notice needed. */
const SUCCESS_OUTCOMES: ReadonlySet<string> = new Set([
  "dispatched",
  "resumed",
  "already_running",
  "stopped",
  "queued",
]);

/**
 * Map a control Result to a user notice. `null` = success (clear the notice).
 * Refusal outcomes (`ok:true` but not a success literal) get friendly copy so
 * a race / blocked control is never invisible.
 */
function noticeFor(r: Result<{ readonly outcome: string }>): string | null {
  if (!r.ok) return r.error.message;
  if (SUCCESS_OUTCOMES.has(r.data.outcome)) return null;
  switch (r.data.outcome) {
    case "lease_busy":
      return "Busy — another operation is in progress. Try again.";
    case "no_active_run":
      return "No active mission run.";
    case "not_accepted":
    case "stale_acceptance":
      return "Accept the contract before starting.";
    case "plan_not_accepted":
      return "Plan not accepted — review and accept the plan before starting.";
    case "not_ready":
      return "Outline the mission before starting.";
    case "blocked_approval":
      return "Resolve the pending approval first.";
    case "blocked_error":
      return "Mission paused after an error — use Recover.";
    case "blocked_terminal":
    case "already_terminal":
      return "The mission run has already ended.";
    case "not_recoverable":
      return "This pause isn't an error — use Continue.";
    case "session_has_active_run":
    case "active_run_exists":
      return "A mission run is already active.";
    case "no_failed_run":
      return "No failed run to recover.";
    case "provider_unavailable":
      return "No inference provider — unlock Vex or set up a provider.";
    case "status_changed":
      return "Mission state changed — re-check and retry.";
    default:
      return "Couldn't complete the action. Re-check the mission state.";
  }
}

/**
 * Renew has its own outcome vocabulary that collides by STRING with the other
 * controls (e.g. `not_accepted` here means "the source mission was never
 * accepted", not "accept this draft"; `session_has_active_run` is renew-only),
 * so it gets a dedicated mapper instead of the shared `noticeFor`. `renewed` is
 * the success literal → null (clears the notice).
 */
function renewNoticeFor(r: Result<MissionRenewResult>): string | null {
  if (!r.ok) return r.error.message;
  switch (r.data.outcome) {
    case "renewed":
      return null;
    case "previous_mission_not_found":
      return "The mission to renew was not found.";
    case "session_mismatch":
      return "That mission belongs to a different session.";
    case "not_accepted":
      return "The source mission was never accepted — nothing to renew from.";
    case "not_terminal_yet":
      return `The source mission isn't finished yet (status ${r.data.runStatus}). Wait for it to finish first.`;
    case "session_has_active_run":
      return `A mission run is already active (status ${r.data.runStatus}). Stop it before renewing.`;
    case "session_has_pending_draft":
      return "A draft mission already exists for this session — accept or discard it before renewing again.";
    default:
      return assertNever(r.data);
  }
}

function readDraft(
  data: Result<MissionDraftDto | null> | undefined,
): MissionDraftDto | null {
  return data && data.ok ? data.data : null;
}

function readReadyDiff(
  data: Result<MissionGetDiffResult> | undefined,
): Extract<MissionGetDiffResult, { outcome: "ready" }> | null {
  if (!data || !data.ok || data.data.outcome !== "ready") return null;
  return data.data;
}

function readRuntime(
  data: Result<RuntimeStateDto> | undefined,
): RuntimeStateDto | null {
  return data && data.ok ? data.data : null;
}

/** The renew source ({ missionId } when a terminal accepted mission exists) or null. */
function readRenewable(
  data: Result<MissionGetRenewableSourceResult> | undefined,
): MissionGetRenewableSourceResult {
  return data && data.ok ? data.data : null;
}

export function MissionControls({
  sessionId,
}: MissionControlsProps): JSX.Element | null {
  // Keep the draft/diff fresh against MAIN-process (agent tool) writes — the
  // review bar must appear the moment the agent finishes the draft, not a
  // staleTime later.
  useMissionLiveSync(sessionId);
  const runtimeQuery = useRuntimeState(sessionId);
  const draftQuery = useMissionDraft(sessionId);
  const draft = readDraft(draftQuery.data);
  const diffQuery = useMissionDiff(sessionId, draft?.missionId ?? null);
  const renewableQuery = useRenewableMissionSource(sessionId);

  const start = useMissionStart();
  const cont = useMissionContinue();
  const recover = useMissionRetry();
  const edit = useEditMission();
  const stop = useMissionStop();
  const renew = useMissionRenew();

  const [notice, setNotice] = useState<ControlNotice>(null);
  // Opens the contract review dialog owned by MissionRail (shared uiStore
  // enum — see MissionRail's mutual-exclusion note).
  const setReviewModal = useUiStore((s) => s.setReviewModal);
  // Live-turn gate for the review bar: the draft flips `ready` on the TOOL
  // CALL commit, mid-turn — revealing the bar there beats the agent's own
  // closing summary (and the contract could still change before the turn
  // ends). `useIsChatSubmitting` spans the ENTIRE turn IPC — provider streams,
  // the quiet tool-execution gaps between them, and the closing message. The
  // stream preview is NOT a substitute: it clears on every intermediate
  // assistant append, so the bar would flash during tool calls. A cancelled/
  // failed turn settles the mutation, so the bar can never wedge shut.
  const turnActive = useIsChatSubmitting(sessionId);

  const run = useCallback(
    async <T extends { readonly outcome: string }>(
      action: () => Promise<Result<T>>,
      map: (r: Result<T>) => string | null = noticeFor,
    ): Promise<void> => {
      try {
        const text = map(await action());
        setNotice(text === null ? null : { tone: "error", text });
      } catch {
        setNotice({
          tone: "error",
          text: "Couldn't complete the action. Re-check the mission state.",
        });
      }
    },
    [],
  );

  const runtime = readRuntime(runtimeQuery.data);
  // Render gate: only the runtime state is required. The active-run toolbar and
  // every gate below read it; the draft / renew-source are read AFTER this so a
  // null draft (always true mid-run) never hides the controls.
  if (runtime === null) return null;

  const anyPending =
    start.isPending ||
    cont.isPending ||
    recover.isPending ||
    edit.isPending ||
    stop.isPending ||
    renew.isPending;
  // Disable while a control is in flight OR one is already pending server-side.
  const disabled = anyPending || runtime.pendingControlKind !== null;

  // ACTIVE RUN → status-gated toolbar (keys off runtime.status alone).
  if (runtime.hasActiveRun) {
    const status = runtime.status;
    const canContinue = status === "paused_wake" || status === "paused_user";
    const canRecover = status === "paused_error";
    const canEdit = status !== "paused_approval";
    return (
      <div
        data-vex-area="mission-controls"
        role="group"
        aria-label="Mission controls"
        className="mt-3 flex flex-wrap items-center gap-2"
      >
        <ControlButton
          label="Continue"
          disabled={disabled || !canContinue}
          onClick={() => void run(() => cont.mutateAsync({ sessionId }))}
        />
        <ControlButton
          label="Recover"
          disabled={disabled || !canRecover}
          onClick={() => void run(() => recover.mutateAsync({ sessionId }))}
        />
        <ControlButton
          label="Edit"
          disabled={disabled || !canEdit}
          onClick={() => void run(() => edit.mutateAsync({ sessionId }))}
        />
        <ControlButton
          label="Stop"
          tone="danger"
          disabled={disabled}
          onClick={() => void run(() => stop.mutateAsync({ sessionId }))}
        />
        {notice !== null ? <ControlNoticeLine text={notice.text} /> : null}
      </div>
    );
  }

  // NO ACTIVE RUN → Start an accepted/ready draft; Start wins over Renew when
  // both could apply (a freshly accepted contract is the more immediate action).
  const diff = readReadyDiff(diffQuery.data);
  const canStart =
    draft !== null &&
    draft.status === "ready" &&
    diff !== null &&
    diff.isAccepted &&
    !diff.isDirty;
  // Contract pending acceptance (a draft exists that is not accepted-clean)
  // with no active run: the runtime prequote gate fail-closes EVERY on-chain
  // broadcast (reason `wallet_setup`), so surface that as a standing notice —
  // the user must see the block deterministically, not via a paraphrased (and
  // possibly confabulated) agent reply to a blocked tool call.
  const pendingAcceptance = draft !== null && !canStart;
  if (canStart) {
    const missionId = draft.missionId;
    return (
      <div data-vex-area="mission-controls" className="mt-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void run(() => start.mutateAsync({ sessionId, missionId }))
          }
          aria-label="Start mission"
          className={PRIMARY_KEY}
        >
          Start mission
        </button>
        {notice !== null ? <ControlNoticeLine text={notice.text} /> : null}
      </div>
    );
  }

  // No startable draft, but a terminal accepted mission exists → Renew clones it
  // into a fresh draft (the new contract must still be accepted before it runs,
  // so this is non-destructive and needs no confirm step).
  const renewSource = readRenewable(renewableQuery.data);
  // `draft === null` guard mirrors MissionRail's load-bearing guard:
  // `getRenewableSourceForSession` keeps returning the OLD terminal accepted
  // mission even after `mission.renew` (or `edit`) inserts a fresh draft. Without
  // this guard the Renew button LINGERS once a fresh draft exists — so a renew
  // looks like it "does nothing", and each extra click clones ANOTHER duplicate
  // draft. Gating on `draft === null` lets the fresh draft fall through to the
  // acceptance-pending UI below (accept it, then Start).
  if (renewSource !== null && draft === null) {
    const previousMissionId = renewSource.missionId;
    return (
      <div data-vex-area="mission-controls" className="mt-3">
        {pendingAcceptance ? <AcceptancePendingNotice /> : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            void run(
              () => renew.mutateAsync({ sessionId, previousMissionId }),
              renewNoticeFor,
            )
          }
          aria-label="Renew mission"
          className={PRIMARY_KEY}
        >
          Renew mission
        </button>
        {notice !== null ? <ControlNoticeLine text={notice.text} /> : null}
      </div>
    );
  }

  // Contract pending acceptance → ONE next-step surface, never both. Once the
  // draft is reviewable (status `ready` with a computed diff) the outlined
  // "Review & accept contract" bar IS the message — it opens the contract
  // modal, and stacking the warn notice on top of it would just restate the
  // same fact in a scarier voice. While the draft is still in setup (nothing
  // to review yet — the modal would only say "add a goal…") the standing
  // notice carries the why-am-I-blocked signal alone.
  if (draft !== null && pendingAcceptance) {
    const reviewable =
      draft.status === "ready" && diff !== null && !turnActive;
    return (
      <div data-vex-area="mission-controls" className="mt-3">
        {reviewable ? (
          <button
            type="button"
            onClick={() => setReviewModal("mission")}
            aria-label="Review and accept mission contract"
            data-vex-action="review-contract"
            className={REVIEW_KEY}
          >
            Review &amp; accept contract
          </button>
        ) : (
          <AcceptancePendingNotice />
        )}
      </div>
    );
  }

  return null;
}

/**
 * Standing muted-warn notice while a mission session's contract is pending
 * acceptance: mirrors the runtime prequote gate's `wallet_setup` fail-close
 * (no active run → every swap/bridge/send broadcast is refused), so the block
 * is visible in the UI regardless of how the agent narrates it.
 */
function AcceptancePendingNotice(): JSX.Element {
  return (
    <p
      role="status"
      data-vex-state="acceptance-pending"
      className="mb-2 w-full text-xs text-warning"
    >
      Mission contract not accepted — on-chain actions (swaps, bridges, sends)
      are blocked until you accept the contract and start the mission.
    </p>
  );
}

function ControlButton({
  label,
  onClick,
  disabled,
  tone,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly tone?: "danger";
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${label} mission`}
      className={cn(
        // Toolbar keys: quiet mono-uppercase hairline pills; Stop keeps the
        // destructive tone with the one sanctioned danger fill (/10).
        "inline-flex h-8 items-center rounded-full border px-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:cursor-not-allowed disabled:opacity-40",
        tone === "danger"
          ? "border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-[var(--vex-line-strong)] text-[var(--vex-text-2)] hover:bg-white/[0.06] hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function ControlNoticeLine({ text }: { readonly text: string }): JSX.Element {
  return (
    <p role="alert" className="w-full text-xs text-destructive">
      {text}
    </p>
  );
}
