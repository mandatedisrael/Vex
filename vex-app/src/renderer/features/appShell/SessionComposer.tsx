/**
 * Session composer — THE COMMAND DECK (S2 rebrand of the puzzle 04 extract).
 *
 * Owns:
 *   - textarea + auto-grow + the send/stop/stopping key,
 *   - the PLAN switch (chrome row, left) — the single control point for
 *     session-scoped plan mode; `SessionPlanCard` only displays the plan,
 *   - mission-run-status gating on free-text submit,
 *   - composer notice (success / error / inline Retry on a retryable error),
 *   - starter chips (hidden in mission mode — replaced by the mission
 *     contract card the parent renders),
 *   - the stage presence (phase 4, kept in phase 5): on the welcome/idle
 *     stage the parent passes `stage` and the instrument grows — taller
 *     textarea, larger type, near-opaque ink frame so it reads over the
 *     Signal Sky. The old trust letterpress moved onto the stage's bottom
 *     row (`SessionWelcomeHero`).
 *
 * Pure helpers (gating reasons, placeholders) live in `composer-helpers.ts`.
 * Mission controls (start/continue/recover/stop/edit/renew) are buttons in
 * `MissionControls.tsx`, mounted by the parent — this file owns only the
 * chat-turn submit + its notice, never command parsing.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StopCircleIcon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useSubmitChat } from "../../lib/api/chat.js";
import {
  flattenTranscriptPages,
  useTranscriptInfinite,
} from "../../lib/api/messages.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
import {
  useSessionModel,
  useSessionPlan,
  useSetPlanMode,
} from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import {
  FREE_TEXT_DISALLOWED,
  gatedReason,
  placeholderFor,
  readRunStatus,
  submitSuccessText,
} from "./composer-helpers.js";
import { ComposerQuickActions } from "./ComposerQuickActions.js";
import { PlanSwitch } from "./PlanSwitch.js";
import { nextReasoningEffort, ReasoningSwitch } from "./ReasoningSwitch.js";
import { ticketEyebrowLabel } from "./composer/composer-ticket.js";
import {
  PromptGlyph,
  TicketFlowStrip,
  TicketHeader,
} from "./composer/TicketChrome.js";

/** Welcome/agent default prompt — the plain-English order the operator
 * types. Mission-mode placeholders still come from `placeholderFor`. */
const AGENT_PLACEHOLDER =
  "Short gold in this range, stop at 4170. Plain English.";

/**
 * Shared pill geometry for the send key's three states (EXECUTE / stop /
 * stopping) — a fixed min-width keeps every hard-cut swap from shifting the
 * bottom rail (the landing `.btn` mono pill). The enabled EXECUTE fills the
 * accent with the accent-contrast ink; stop keeps the accent rim; stopping
 * goes inert while the rail hint carries the "Stopping…" label.
 */
const SEND_KEY_BASE =
  "inline-flex h-8 min-w-[104px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type ComposerNotice =
  | {
      readonly tone: "info" | "error";
      readonly text: string;
      /**
       * Present only for a retryable provider error in a known agent session:
       * an inline Retry re-sends `message` into `sessionId`. Bound to the
       * session so switching sessions can never resend into the wrong one.
       */
      readonly retry?: { readonly sessionId: string; readonly message: string };
    }
  | null;

export interface SessionComposerProps {
  readonly activeSession: SessionListItem | null;
  readonly activeSessionId: string | null;
  /**
   * Welcome/idle stage presence — presentation only. The parent
   * (`SessionPanel`) sets it for the Signal Sky stage: taller idle
   * textarea, 16px type, and a near-opaque ink frame (solid color-mix, NO
   * blur) so the instrument reads over the sky. The state machine, roles
   * and gating are identical in both variants.
   */
  readonly stage?: boolean;
}

export function SessionComposer({
  activeSession,
  activeSessionId,
  stage = false,
}: SessionComposerProps): JSX.Element {
  // Submit/enable gate on the canonical selected id (uiStore), NOT the
  // detail-query object: the engine ingress loads its own session context,
  // so a turn can be sent the moment a session is active — even while the
  // `sessions.get` detail query is still loading or errored (this was the
  // "send button permanently disabled" bug). `activeSession` stays for
  // soft, detail-derived UI only (placeholder, quick-action visibility).
  const sessionId = activeSessionId;
  // Destructure stable members: `mutateAsync`/`stop` are referentially stable
  // (observer-bound + useCallback), so the hand-off effect below depends on
  // `submitTurn` instead of the per-render `useSubmitChat()` object — which
  // otherwise re-ran the effect every render.
  const {
    isPending: submitPending,
    mutateAsync: submitTurn,
    stop: stopTurn,
  } = useSubmitChat();
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const pendingFirstMessage = useUiStore((s) => s.pendingFirstMessage);
  const clearPendingFirstMessage = useUiStore((s) => s.clearPendingFirstMessage);
  const setSessionReasoningEffort = useUiStore(
    (s) => s.setSessionReasoningEffort,
  );
  // Per-session reasoning-effort choice (S6) — launch-ephemeral; absent key
  // means the engine default "medium". Selector returns a primitive, so the
  // subscription stays referentially stable.
  const reasoningEffort = useUiStore((s) =>
    sessionId === null
      ? "medium"
      : (s.reasoningEffortBySession[sessionId] ?? "medium"),
  );
  const handedOffRef = useRef<string | null>(null);
  const runtimeQuery = useRuntimeState(sessionId);
  // Reasoning capability (S6) — same cached query the runtime bar reads
  // (`sessions.getModel`, shared key, no extra fetch). The REASON control
  // mounts ONLY for an explicit `supportsReasoning === true`; `false`,
  // `null` (unknown: locked vault, catalog unreachable) and the welcome
  // state all hide it, and the submit input then omits the field so
  // non-reasoning models keep their exact request shape. Declared ABOVE
  // `runChatSubmit`, which closes over `supportsReasoning`.
  const modelQuery = useSessionModel(sessionId);
  const supportsReasoning =
    modelQuery.data?.ok === true &&
    modelQuery.data.data.supportsReasoning === true;
  const cycleReasoningEffort = useCallback((): void => {
    if (sessionId === null) return;
    setSessionReasoningEffort(sessionId, nextReasoningEffort(reasoningEffort));
  }, [sessionId, setSessionReasoningEffort, reasoningEffort]);

  const [draft, setDraft] = useState<string>("");
  const [notice, setNotice] = useState<ComposerNotice>(null);
  // Stop acknowledgment: first click on Stop cancels the turn AND flips the
  // key to a disabled "Stopping" state so the user sees the request landed.
  // stopTurn stays idempotent — this state is purely the acknowledgment.
  const [stopRequested, setStopRequested] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Synchronous in-flight mutex (render `submitPending` lags a tick) + a mirror
  // of the latest active session so a submit that settles after a session
  // switch is dropped instead of painting a notice on the wrong session.
  const inFlightRef = useRef(false);
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;

  useLayoutEffect((): void => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // Clear the composer notice when the active session changes so a stale
  // error / Retry from one session never renders on (or resends into) another.
  useEffect(() => {
    setNotice(null);
  }, [sessionId]);

  // Reset the stop acknowledgment when the turn settles (success, error, or
  // the retry path re-arming) so the next turn starts from a clean Stop key.
  useEffect(() => {
    if (!submitPending) setStopRequested(false);
  }, [submitPending]);

  // Single owner of a chat-turn submit + its failure/success notice. A
  // retryable provider error in a KNOWN agent session arms an inline Retry
  // bound to that session; every other failure keeps the restore-draft
  // behavior. The in-flight ref is the real mutex (render state lags), and a
  // session switch mid-flight drops the now-stale outcome.
  const runChatSubmit = useCallback(
    async (message: string): Promise<void> => {
      const targetSessionId = sessionId;
      if (targetSessionId === null || inFlightRef.current) return;
      inFlightRef.current = true;
      setNotice(null);
      try {
        // `reasoningEffort` rides along ONLY when the active model supports
        // reasoning (schema-optional) — omitted, the engine applies its own
        // default and never sends a reasoning param to non-reasoning models.
        const outcome = await submitTurn({
          sessionId: targetSessionId,
          message,
          ...(supportsReasoning && { reasoningEffort }),
        });
        if (sessionIdRef.current !== targetSessionId) return;
        if (!outcome.ok) {
          const armRetry =
            activeSession?.id === targetSessionId &&
            activeSession?.mode === "agent" &&
            outcome.error.retryable;
          if (armRetry) {
            setNotice({
              tone: "error",
              text: outcome.error.message,
              retry: { sessionId: targetSessionId, message },
            });
          } else {
            // No Retry → keep the message so it is not lost (restore only if the
            // user has not typed something new into the now-empty input).
            setNotice({ tone: "error", text: outcome.error.message });
            setDraft((cur) => (cur.length === 0 ? message : cur));
          }
          return;
        }
        const successText = submitSuccessText(outcome.data);
        if (successText !== null) setNotice({ tone: "info", text: successText });
      } finally {
        inFlightRef.current = false;
      }
    },
    [sessionId, submitTurn, activeSession, supportsReasoning, reasoningEffort],
  );

  const handleRetry = useCallback(async (): Promise<void> => {
    const r = notice?.retry;
    if (r === undefined || r.sessionId !== sessionId) return;
    await runChatSubmit(r.message);
  }, [notice, sessionId, runChatSubmit]);

  // Welcome→create hand-off: when this composer mounts for the freshly
  // created session, consume the first message stashed by SessionCreator and
  // send it through the normal submit path so success/failure reuse the same
  // notice + draft-preserve UX (a failed first send is visible, never lost).
  // `handedOffRef` + clear-before-submit make it consume-once (Strict Mode
  // safe); the live store clear avoids a stale-closure re-send.
  useEffect(() => {
    if (
      sessionId === null ||
      pendingFirstMessage === null ||
      pendingFirstMessage.sessionId !== sessionId
    ) {
      return;
    }
    const key = `${pendingFirstMessage.sessionId}:${pendingFirstMessage.message}`;
    if (handedOffRef.current === key) return;
    handedOffRef.current = key;
    const message = pendingFirstMessage.message;
    clearPendingFirstMessage();
    void runChatSubmit(message);
  }, [sessionId, pendingFirstMessage, clearPendingFirstMessage, runChatSubmit]);

  const runStatus = readRunStatus(runtimeQuery.data);
  const freeTextGate = runStatus !== null && FREE_TEXT_DISALLOWED.has(runStatus);

  // Plan mode — same engine-owned, session-scoped state SessionPlanCard
  // displays (same query key, no extra fetch). The PLAN switch is the single
  // control point; no optimistic write, so a server refusal snaps back on
  // the invalidate-driven refetch.
  const planQuery = useSessionPlan(sessionId);
  const setPlanMode = useSetPlanMode();
  const plan = planQuery.data?.ok === true ? planQuery.data.data : null;
  const planOn = plan?.enabled ?? false;
  // Parked-for-acceptance is the state where the engine refuses a toggle
  // (`blocked_pending_acceptance`) — disable up front instead of bouncing.
  const planMissionBlocked =
    activeSession?.missionStatus === "paused_plan_acceptance";
  const { mutate: mutatePlanMode } = setPlanMode;
  const togglePlanMode = useCallback((): void => {
    if (sessionId === null) return;
    mutatePlanMode({ sessionId, enabled: !planOn });
  }, [sessionId, mutatePlanMode, planOn]);

  // Quick-action chips are starters for an EMPTY conversation. Show them on the
  // welcome screen and in a freshly created, still-empty session; hide them
  // once the session has any messages (reuses the transcript query already
  // mounted by SessionTranscript — same cache key, no extra fetch). Gated on
  // a resolved `activeSession` + a SUCCEEDED transcript query so a loading or
  // errored session never flickers the chips in or out.
  const transcriptQuery = useTranscriptInfinite(sessionId ?? "");
  const transcriptPages = transcriptQuery.data?.pages;
  const transcriptEmpty = useMemo(
    () =>
      transcriptPages === undefined
        ? true
        : flattenTranscriptPages(transcriptPages).length === 0,
    [transcriptPages],
  );
  const showQuickActions =
    sessionId === null ||
    (activeSession !== null &&
      activeSession.mode !== "mission" &&
      transcriptQuery.isSuccess &&
      transcriptEmpty);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const message = draft.trim();
      if (message.length === 0) return;
      // Welcome state (no session yet): Send opens the new-session modal
      // seeded with this draft; the created session's composer then sends it
      // as the first turn (hand-off effect above). Draft is kept so cancelling
      // the modal preserves what the user typed.
      if (sessionId === null) {
        openCreateSession(message);
        return;
      }
      // Enter can fire a submit even while a turn is in flight (requestSubmit()
      // ignores the disabled Send button), so gate here.
      if (submitPending) return;
      // Free text is gated while a mission run is active — mission controls
      // live in the MissionControls strip above, not in the composer.
      if (freeTextGate) {
        setNotice({ tone: "error", text: gatedReason(runStatus) });
        return;
      }
      // Clear optimistically — the message is on its way to the agent and the
      // transcript already shows it. runChatSubmit owns failure handling
      // (retryable → inline Retry; otherwise restore the draft).
      setDraft("");
      await runChatSubmit(message);
    },
    [
      sessionId,
      draft,
      freeTextGate,
      openCreateSession,
      runStatus,
      submitPending,
      runChatSubmit,
    ],
  );

  const applyQuickAction = useCallback((prompt: string): void => {
    setDraft(prompt);
    setNotice(null);
  }, []);

  const draftEmpty = draft.trim().length === 0;
  const submitDisabled = draftEmpty || submitPending;
  // Stop acknowledged and the turn still in flight — the send key goes
  // inert and the chrome-row hint swaps to the STOPPING… label.
  const stopping = submitPending && stopRequested;

  // Approval echo — a mission run parked for approval reaches the composer as
  // `runStatus === "paused_approval"` (already in FREE_TEXT_DISALLOWED, so the
  // input is frozen). No new plumbing: this same signal flips the ticket
  // chrome to the amber ws-alert motif.
  const awaitingApproval = runStatus === "paused_approval";
  const eyebrowLabel = ticketEyebrowLabel({
    awaitingApproval,
    planOn,
    sessionId,
    stage,
    session: activeSession,
  });
  // Mission-mode placeholders stay owned by `placeholderFor`; the welcome /
  // agent default is the plain-English order example. Plan mode overrides both.
  const placeholder = planOn
    ? "Describe the goal — Vex proposes a plan before anything executes."
    : activeSession?.mode === "mission"
      ? placeholderFor(activeSession)
      : AGENT_PLACEHOLDER;

  return (
    <>
      <div className="mt-6">
        <form
          ref={formRef}
          onSubmit={onSubmit}
          data-vex-area="chat-composer"
          data-vex-ticket-state={awaitingApproval ? "approval" : "input"}
          className={cn(
            // THE ORDER TICKET — gradient instrument frame, resting accent
            // ring, focus glow + sweep + 1px lift, and the amber approval
            // echo all owned by `.vex-ticket` (globals.css) so no resting
            // glow shadow ever lands in a className (design guard).
            "vex-ticket relative overflow-hidden rounded-[14px]",
            // Stage: 8% Signal-Sky bleed (no blur — banned) so the ticket
            // sits IN the scene while staying near-opaque.
            stage && "vex-ticket--stage",
          )}
        >
          {/* MODE LINE — 1px accent ink along the top edge, drawn (scaleX
           * 0→1) when plan mode turns on. Reuses the .vex-sign-stroke draw
           * transition; .vex-mode-line--on holds it at full width. */}
          <span
            aria-hidden
            className={cn(
              "vex-sign-stroke pointer-events-none absolute inset-x-0 top-0 z-10 h-px rounded-none bg-[var(--vex-accent)]",
              planOn && "vex-mode-line--on",
            )}
          />

          {/* HEADER MICROBAR — the landing .ws-bar: a context eyebrow and a
           * live status dot along the instrument's top edge. */}
          <TicketHeader label={eyebrowLabel} awaiting={awaitingApproval} />

          {/* FIELD ZONE — the prompt glyph leads the textarea; the focus
           * sweep beam rides the bottom edge of this zone (under the field). */}
          <div className="relative flex items-start gap-2.5 px-4 pb-2 pt-1.5">
            <PromptGlyph empty={draftEmpty} />
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter and IME composition insert a newline.
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={placeholder}
              aria-label="Session draft"
              className={cn(
                "block w-full flex-1 resize-none overflow-y-auto bg-transparent leading-[1.7] text-foreground caret-[var(--vex-accent)] outline-none",
                "max-h-[200px] placeholder:text-[var(--vex-text-3)]",
                // Stage: taller idle presence + larger type (the instrument).
                stage ? "min-h-[60px] text-[16px]" : "min-h-[48px] text-[15px]",
              )}
            />
            {/* FOCUS SWEEP — one accent light band travels under the field on
             * focus (globals.css `.vex-ticket-beam`); rests off-screen. */}
            <span aria-hidden className="vex-ticket-beam" />
          </div>

          {/* FLOW STRIP — welcome-stage-only provenance line
           * (PROPOSE → ENFORCE → PROVE), gated by the existing `stage` prop. */}
          {stage ? <TicketFlowStrip /> : null}

          <div className="flex h-12 items-center gap-3 border-t border-[var(--vex-line)] px-3">
            <PlanSwitch
              sessionId={sessionId}
              planOn={planOn}
              busy={setPlanMode.isPending}
              missionBlocked={planMissionBlocked}
              onToggle={togglePlanMode}
            />

            {/* REASON control (S6) — only when the active model supports
             * reasoning; welcome (no session) hides it (capability unknown). */}
            {sessionId !== null && supportsReasoning ? (
              <ReasoningSwitch
                effort={reasoningEffort}
                busy={submitPending}
                onCycle={cycleReasoningEffort}
              />
            ) : null}

            {/* Chrome-row hint — mono 10px, centered between the mode
             * cluster and the send key; while a stop is acknowledged it
             * carries the STOPPING… label (the key itself goes inert). */}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-center font-mono text-[10px] uppercase tracking-[0.14em]",
                stopping ? "text-[var(--vex-text-2)]" : "text-[var(--vex-text-3)]",
              )}
            >
              {stopping
                ? "Stopping…"
                : sessionId === null
                  ? "type a message to start a session"
                  : "Enter ↵ send · Shift+Enter newline"}
            </span>

            {/* THE EXECUTE KEY — three hard-cut states in one pill slot. */}
            {submitPending ? (
              stopRequested ? (
                <button
                  type="button"
                  disabled
                  aria-label="Stopping"
                  className={cn(
                    SEND_KEY_BASE,
                    "border-[var(--vex-line-strong)] bg-[var(--vex-surface-0)] text-[var(--vex-text-3)]",
                  )}
                >
                  <HugeiconsIcon icon={StopCircleIcon} size={14} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStopRequested(true);
                    stopTurn();
                  }}
                  aria-label="Stop generating"
                  className={cn(
                    SEND_KEY_BASE,
                    "border-[var(--vex-accent-border-strong)] bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]",
                  )}
                >
                  <HugeiconsIcon icon={StopCircleIcon} size={14} aria-hidden />
                  Stop
                </button>
              )
            ) : (
              <button
                type="submit"
                disabled={submitDisabled}
                aria-label="Send message"
                className={cn(
                  SEND_KEY_BASE,
                  // Ghost/disabled while the field is empty; solid accent fill
                  // with the accent-contrast ink once there is an order to send.
                  submitDisabled
                    ? "border-[var(--vex-line-strong)] bg-transparent text-[var(--vex-text-3)]"
                    : "border-transparent bg-[var(--vex-accent)] text-[var(--vex-accent-contrast)] hover:bg-[var(--vex-accent-hover)] active:scale-[0.98]",
                )}
              >
                Execute
                <span aria-hidden className="text-[0.9em] opacity-80">
                  ⏎
                </span>
              </button>
            )}
          </div>
        </form>
        {/* The welcome trust letterpress that used to sit here moved onto the
         * stage's bottom row (mono lines in `SessionWelcomeHero`). */}
      </div>

      {notice !== null ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className="mt-3 flex items-center gap-2 text-xs"
        >
          <span
            className={
              notice.tone === "error"
                ? "text-destructive"
                : "text-[var(--vex-accent-text)]"
            }
          >
            {notice.text}
          </span>
          {notice.retry !== undefined ? (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={submitPending}
              aria-label="Retry sending the message"
              className="inline-flex shrink-0 items-center rounded-[3px] border border-[color-mix(in_oklab,var(--vex-accent)_40%,transparent)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-accent-text)] transition-colors hover:bg-[var(--vex-accent-fill-8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:cursor-not-allowed disabled:border-[var(--vex-line-strong)] disabled:text-[var(--vex-text-3)]"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {showQuickActions ? (
        <ComposerQuickActions onPick={applyQuickAction} />
      ) : null}
    </>
  );
}
