/**
 * Session composer — THE SIGNAL CONSOLE, a single floating pill bar,
 * rebuilt Grok-style (owner decree 2026-07-21).
 *
 * ONE translucent glass pill — truly `rounded-full` at rest (a slim ~56px
 * stadium; QUIET: the ring is a flat hairline until focus/approval wake it,
 * owner correction 2026-07-21 round 2), relaxing to rounded-[28px] once the
 * field grows multiline — floating over the Eclipse backdrop. Left→right
 * inside the pill:
 *   - the transparent-bg textarea (auto-grow, 16px type, one geometry for
 *     welcome AND session — the Grok pill is the same instrument on both
 *     stages, so the old `stage` presence prop is retired) opens the pill
 *     with a generous left inset — no "+" toggle, no attach, no mic
 *     (owner-excluded). Its DEFAULT welcome/agent prompt rotates through
 *     crypto orders (`usePlaceholderRotator`) rendered as an aria-hidden
 *     FAUX-PLACEHOLDER OVERLAY (a native placeholder attribute cannot
 *     animate): each phrase swaps with a soft ~300ms crossfade + upward
 *     drift (owner: the hard attribute swap read as broken). Starter chips
 *     render detached below whenever an empty conversation has starters,
 *     and DISAPPEAR while the user is typing (draft non-empty → fade/scale
 *     out; empty again → return) inside a fixed-height slot so the pill
 *     never reflows,
 *   - the right cluster: the quiet reasoning-effort selector
 *     (`ReasoningEffortSelect`, the Grok "Szybki ⌄" slot — mounted ONLY for
 *     an agent-stage session/welcome whose model reports a normalized
 *     capability from the GLOBAL model query (`useAvailableModels`, the
 *     same one-global-model fact `sessions.getModel` echoes — sourcing
 *     both stages from the always-warm global query removes the welcome
 *     gap AND the first-message cold-query race); mission sessions never
 *     see it. A quiet inert placeholder fills the slot while that query is
 *     still unresolved so the row never reflows once it settles) and the
 *     round accent send/stop/stopping control (Grok's round key). The row
 *     is `items-center`, so the resting single-line state reads perfectly
 *     level.
 * Owns: mission-run-status gating on free-text submit; the composer notice
 * (success / error / inline Retry on a retryable error).
 *
 * The pill's glass surface + backdrop-blur are the owner-sanctioned third
 * glass surface (see shell-design-guard whitelist). The 1px border, the
 * TRAVELING accent shimmer that circles the ring, the focus step to
 * `--vex-glass-strong`, the soft drop shadow and the amber approval recolor
 * all live in `.vex-console` (globals.css) — token-only, so both themes
 * recolor from `--vex-accent`. The context strip is gone, so the two
 * transient states it carried survive as a tiny tag FLOATING above the pill:
 * amber "AWAITING SIGNATURE" while a run is parked for approval or muted
 * "Stopping…" while a stop settles. Active work is shown on the agent avatar
 * in the transcript instead of adding another label above the input.
 *
 * Pure helpers: gating reasons + placeholders in `composer-helpers.ts`.
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
import { AnimatePresence, motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, StopCircleIcon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import {
  selectDefaultReasoningEffort,
  type ReasoningEffort,
} from "@shared/schemas/reasoning.js";
import { useSubmitChat } from "../../lib/api/chat.js";
import {
  flattenTranscriptPages,
  useTranscriptInfinite,
} from "../../lib/api/messages.js";
import { useAvailableModels } from "../../lib/api/models.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import {
  FREE_TEXT_DISALLOWED,
  gatedReason,
  placeholderFor,
  readRunStatus,
  submitFailureNotice,
  submitSuccessText,
} from "./composer-helpers.js";
import { ComposerQuickActions } from "./ComposerQuickActions.js";
import {
  ReasoningEffortPlaceholder,
  ReasoningEffortSelect,
} from "./ReasoningEffortSelect.js";
import { ModelBrandIcon } from "../wizard/steps/provider/ModelBrandIcon.js";
import { usePlaceholderRotator } from "./composer-placeholders.js";
import { HypervexingSummon } from "./workspace/HypervexingSummon.js";
import { EASE_STANDARD } from "../../lib/motion.js";

/**
 * Shared geometry for the round send control's three states (send / stop /
 * stopping) — one fixed circle so every hard-cut swap holds its slot in the
 * input row. h-10 = Grok's 40px round key inside the ~56px resting pill
 * (owner decree 2026-07-21). Send fills the accent with the accent-contrast
 * glyph; the disabled (empty) send is a ghost hairline circle; stop keeps
 * the accent rim; stopping goes inert while the floating tag above the pill
 * carries the "Stopping…" label.
 */
const SEND_KEY_BASE =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Pill-radius relax threshold: a single 16px/1.6 line + the field's
 * py-[9px] lands at ~44px; two lines land at ~69px. Above this the pill
 * relaxes from rounded-full to rounded-[28px] so the stadium curve never
 * cuts into a multiline draft. jsdom reports scrollHeight 0 → tests always
 * see the resting rounded-full state.
 */
const SINGLE_LINE_MAX_PX = 52;

/** jsdom-safe reduced-motion probe (the SidebarProfile pattern). */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type ComposerNotice =
  | {
      readonly tone: "info" | "error";
      readonly text: string;
      /**
       * Present only for a retryable provider error in a known agent session:
       * an inline Retry re-sends `message` into `sessionId`. Bound to the
       * session so switching sessions can never resend into the wrong one.
       * `reasoningEffort` is the exact value that rode the FAILED submit
       * (`null` = the field was omitted): Retry resends the same turn
       * verbatim, even if the selector moved since — a retry is not a new
       * choice.
       */
      readonly retry?: {
        readonly sessionId: string;
        readonly message: string;
        readonly reasoningEffort: ReasoningEffort | null;
      };
    }
  | null;

export interface SessionComposerProps {
  readonly activeSession: SessionListItem | null;
  readonly activeSessionId: string | null;
  /**
   * Focus handoff BACK from Hypervexing: true for the render immediately
   * after the shell's exit drain completes and this composer is the return
   * target. The parent owns the "why" (an exit just happened); this
   * component only reacts to the transition and reports it consumed via
   * `onFocusRequestHandled` so the parent can reset it — otherwise a later,
   * unrelated mount of this composer would inherit a stale "focus me" flag.
   */
  readonly focusRequest?: boolean;
  readonly onFocusRequestHandled?: () => void;
}

export function SessionComposer({
  activeSession,
  activeSessionId,
  focusRequest = false,
  onFocusRequestHandled,
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
  const workspaceMode = useUiStore((s) => s.workspaceMode);
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const createSessionInitialTurn = useUiStore((s) => s.createSessionInitialTurn);
  const clearCreateSessionInitialTurn = useUiStore(
    (s) => s.clearCreateSessionInitialTurn,
  );
  // Per-session reasoning-effort pick (S6/D5) — launch-ephemeral, RAW from
  // the store (undefined = the user never picked). Validation against the
  // model's FINAL selectable set + the preselect default both live in
  // `effectiveReasoningEffort` below, so a stale pick can never ride a
  // submit. Primitive/undefined selector keeps the subscription
  // referentially stable.
  const storedReasoningEffort = useUiStore((s) =>
    sessionId === null ? undefined : s.reasoningEffortBySession[sessionId],
  );
  const setSessionReasoningEffort = useUiStore(
    (s) => s.setSessionReasoningEffort,
  );
  // Welcome-stage-only live pick (E3): there is no real session id yet to key
  // `reasoningEffortBySession` on, and this value must survive a cancelled
  // create (this SAME composer instance stays mounted behind the modal —
  // `undefined` = never picked, falls back to the computed default exactly
  // like `storedReasoningEffort` does in-session).
  const [welcomeReasoningEffort, setWelcomeReasoningEffort] = useState<
    ReasoningEffort | undefined
  >(undefined);
  const handedOffRef = useRef<string | null>(null);
  const runtimeQuery = useRuntimeState(sessionId);
  // Per-model reasoning capability (S6/D3–D5, E2) — sourced from the GLOBAL
  // model query (`useAvailableModels`, always-warm single cache key) on BOTH
  // stages instead of the per-session `sessions.getModel` query: Vex uses
  // one global model for every session, so welcome never needs to wait for
  // a session id to exist, and a freshly-created session's composer never
  // races a cold per-session cache entry either. `reasoning` is the
  // D4-set-normalized FINAL selectable set, or null = "no selector". It
  // gates BOTH the selector mount and the submit payload: non-null in an
  // agent-stage session → the turn ALWAYS carries the effective selection
  // (an explicit "none"/Off rides verbatim); null → the field is OMITTED
  // entirely — never a store fallback (the legacy boolean-only
  // `supportsReasoning` no longer rides a "medium" default; per D6 the
  // engine then sends no reasoning param at all). Mission sessions never
  // mount the selector and never carry the field — their ingress ignores
  // per-turn options (plan D4, v1 agent-only scope). Only the true WELCOME
  // stage (no session selected at all, `activeSessionId === null`) counts
  // as agent-stage by default — a session that IS selected but whose detail
  // hasn't resolved yet (`SessionPanel` renders `activeSession = null`
  // while loading/erroring) is NOT agent-stage: the model-capability query
  // can resolve before the session detail does, and showing the selector on
  // that race would let a mission session's turn ride a reasoning pick that
  // main/ingress silently drops (blocker 2). Declared ABOVE `runChatSubmit`,
  // which closes over the gate.
  const modelsQuery = useAvailableModels();
  const modelsResolved = modelsQuery.data !== undefined;
  const reasoningCapability =
    modelsQuery.data?.ok === true
      ? (modelsQuery.data.data.models[0]?.reasoning ?? null)
      : null;
  // The global model's id — feeds the provider brand mark beside the effort
  // slot (owner decree 2026-07-21 round 4: the SessionRuntimeBar treatment,
  // on BOTH stages). Same warm query, no extra fetch.
  const globalModelId =
    modelsQuery.data?.ok === true
      ? (modelsQuery.data.data.models[0]?.modelId ?? null)
      : null;
  const reasoningStageIsAgent =
    activeSessionId === null || activeSession?.mode === "agent";
  const carryReasoningEffort =
    reasoningCapability !== null && reasoningStageIsAgent;
  // D5 effective selection: the stored/welcome pick IF the final set still
  // contains it, else the shared TESTED preselect
  // (`selectDefaultReasoningEffort` — never re-derived here). Non-null
  // exactly when a capability exists.
  const effectiveReasoningEffort = useMemo<ReasoningEffort | null>(() => {
    if (reasoningCapability === null) return null;
    const pick = sessionId === null ? welcomeReasoningEffort : storedReasoningEffort;
    if (pick !== undefined && reasoningCapability.supportedEfforts.includes(pick)) {
      return pick;
    }
    return selectDefaultReasoningEffort(reasoningCapability);
  }, [reasoningCapability, sessionId, storedReasoningEffort, welcomeReasoningEffort]);

  const [draft, setDraft] = useState<string>("");
  const [notice, setNotice] = useState<ComposerNotice>(null);
  // Stop acknowledgment: first click on Stop cancels the turn AND flips the
  // key to a disabled "Stopping" state so the user sees the request landed.
  // stopTurn stays idempotent — this state is purely the acknowledgment.
  const [stopRequested, setStopRequested] = useState<boolean>(false);
  // Focus flag for the placeholder rotator: the rotating welcome placeholder
  // freezes on its current phrase while the field is focused or holds a draft,
  // so it never shuffles under an operator mid-thought.
  const [focused, setFocused] = useState<boolean>(false);
  // Presentation-only pill geometry: true once the auto-grow field clears
  // the single-line band, relaxing rounded-full → rounded-[28px].
  const [multiline, setMultiline] = useState<boolean>(false);
  // Sampled once per mount (the WelcomePortfolioPanel idiom) — the chips'
  // enter/exit declaration must not flip mid-animation.
  const [reducedMotion] = useState(prefersReducedMotion);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The field slot around the textarea — `.vex-composer-grow` (globals.css)
  // transitions the measured height this component mirrors onto it, so the
  // pill's growth glides instead of snapping (owner smoothness decree
  // 2026-07-22). Height is written imperatively in the same layout effect
  // that sizes the textarea — one measurement, two consumers, no extra
  // render.
  const fieldSlotRef = useRef<HTMLDivElement>(null);
  // One-shot caret handoff for a starter-chip pick: the seeded draft must
  // land with the field focused and the caret at the END, in the same
  // gesture as the grow (not on the click itself — the controlled value has
  // not committed yet at that point). Consumed by the layout effect below.
  const seedCaretRef = useRef(false);
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
    const measured = Math.min(el.scrollHeight, 200);
    // The textarea SNAPS to its measured height (text layout + caret need
    // real geometry immediately); the field slot mirrors the same px value
    // and `.vex-composer-grow` TRANSITIONS it on the exact clock/curve of
    // `.vex-console`'s border-radius relax — height and radius read as ONE
    // gesture, growth revealing downward under the slot's overflow clip.
    // Guarded on a real measurement: jsdom (and a hidden mount) reports
    // scrollHeight 0 — the slot then keeps its natural auto height so
    // nothing is ever clipped away by a bogus 0px write.
    el.style.height = `${measured}px`;
    if (measured > 0) {
      const slot = fieldSlotRef.current;
      if (slot !== null) slot.style.height = `${measured}px`;
    }
    // Chip-seeded draft: finish the single gesture — focus the field with
    // the caret at the end of the seeded prompt (and the end scrolled into
    // view for a draft taller than the 200px cap).
    if (seedCaretRef.current) {
      seedCaretRef.current = false;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    }
    setMultiline(el.scrollHeight > SINGLE_LINE_MAX_PX);
  }, [draft]);

  // Clear the composer notice when the active session changes so a stale
  // error / Retry from one session never renders on (or resends into) another.
  useEffect(() => {
    setNotice(null);
  }, [sessionId]);

  // Focus handoff back from Hypervexing (see the prop doc): react to the
  // transition rather than mount, since this same instance can receive the
  // request without remounting.
  useEffect(() => {
    if (!focusRequest) return;
    textareaRef.current?.focus();
    onFocusRequestHandled?.();
  }, [focusRequest, onFocusRequestHandled]);

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
    async (
      message: string,
      reasoningOverride?: ReasoningEffort | null,
    ): Promise<void> => {
      const targetSessionId = sessionId;
      if (targetSessionId === null || inFlightRef.current) return;
      inFlightRef.current = true;
      setNotice(null);
      // D5 submit contract: a non-null capability in an agent-stage session
      // ALWAYS carries the effective selection (untouched → the computed
      // preselect default; an explicit Off rides as "none" verbatim);
      // capability null → the field is OMITTED entirely — never a store
      // fallback. Retry passes the value that rode the original submit as
      // `reasoningOverride` (null = it was omitted), so a retry resends the
      // SAME turn even if the selector moved since.
      const carriedReasoningEffort =
        reasoningOverride !== undefined
          ? reasoningOverride
          : carryReasoningEffort
            ? effectiveReasoningEffort
            : null;
      try {
        const outcome = await submitTurn({
          sessionId: targetSessionId,
          message,
          ...(carriedReasoningEffort !== null && {
            reasoningEffort: carriedReasoningEffort,
          }),
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
              retry: {
                sessionId: targetSessionId,
                message,
                reasoningEffort: carriedReasoningEffort,
              },
            });
          } else {
            // No Retry → keep the message so it is not lost (restore only if the
            // user has not typed something new into the now-empty input).
            setNotice({ tone: "error", text: outcome.error.message });
            setDraft((cur) => (cur.length === 0 ? message : cur));
          }
          return;
        }
        const failure = submitFailureNotice(outcome.data);
        if (failure !== null) {
          const armRetry =
            failure.retryable &&
            activeSession?.id === targetSessionId &&
            activeSession.mode === "agent";
          setNotice({
            tone: "error",
            text: failure.text,
            ...(armRetry && {
              retry: {
                sessionId: targetSessionId,
                message,
                reasoningEffort: carriedReasoningEffort,
              },
            }),
          });
          return;
        }
        const successText = submitSuccessText(outcome.data);
        if (successText !== null) setNotice({ tone: "info", text: successText });
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      sessionId,
      submitTurn,
      activeSession,
      carryReasoningEffort,
      effectiveReasoningEffort,
    ],
  );

  const handleRetry = useCallback(async (): Promise<void> => {
    const r = notice?.retry;
    if (r === undefined || r.sessionId !== sessionId) return;
    await runChatSubmit(r.message, r.reasoningEffort);
  }, [notice, sessionId, runChatSubmit]);

  // A pick writes the launch-ephemeral per-session store when a real session
  // is active, or the local welcome-stage pick (E3) when it is not — the
  // welcome selector is now legitimately mountable (E2: global capability
  // source), so this is no longer a defensive no-op.
  const handleReasoningPick = useCallback(
    (effort: ReasoningEffort): void => {
      if (sessionId === null) {
        setWelcomeReasoningEffort(effort);
        return;
      }
      setSessionReasoningEffort(sessionId, effort);
    },
    [sessionId, setSessionReasoningEffort],
  );

  // Welcome→create hand-off: when this composer mounts for the freshly
  // created session, consume the turn stashed by the welcome Send press
  // (SNAPSHOTTED at press time — E3/D5; SessionCreator's
  // `completeSessionCreate` has already mode-gated it, e.g. null for a
  // mission create) and send it through the normal submit path so success/
  // failure reuse the same notice + draft-preserve UX (a failed first send
  // is visible, never lost). The snapshot rides as an EXPLICIT override —
  // never recomputed here — and, when non-null, seeds
  // `reasoningEffortBySession` so this session's later renders/switches
  // reflect it exactly like an in-session pick would. `handedOffRef` +
  // clear-before-submit make it consume-once (Strict Mode safe); the live
  // store clear avoids a stale-closure re-send.
  useEffect(() => {
    if (sessionId === null || createSessionInitialTurn === null) return;
    const key = `${sessionId}:${createSessionInitialTurn.message}`;
    if (handedOffRef.current === key) return;
    handedOffRef.current = key;
    const { message, reasoningEffort } = createSessionInitialTurn;
    clearCreateSessionInitialTurn();
    if (reasoningEffort !== null) {
      setSessionReasoningEffort(sessionId, reasoningEffort);
    }
    void runChatSubmit(message, reasoningEffort);
  }, [
    sessionId,
    createSessionInitialTurn,
    clearCreateSessionInitialTurn,
    setSessionReasoningEffort,
    runChatSubmit,
  ]);

  const runStatus = readRunStatus(runtimeQuery.data);
  const freeTextGate = runStatus !== null && FREE_TEXT_DISALLOWED.has(runStatus);

  // The summoning word in the draft, outside the mode — drives the ripple
  // veil, the gradient text paint, and the spellcheck suppression together.
  const summonActive =
    workspaceMode !== "hypervexing" && /hypervexing/i.test(draft);

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
      // seeded with this draft PLUS the reasoning effort SNAPSHOTTED right
      // now (E3/D5) — unresolved capability at this instant → null → a
      // definite omission; resolved+untouched → the computed default. The
      // create-handoff rides this exact value verbatim, never a later
      // recomputation. Draft is kept so cancelling the modal preserves what
      // the user typed (and the welcome-stage pick above survives too — it
      // is this SAME composer instance's local state).
      if (sessionId === null) {
        openCreateSession(message, effectiveReasoningEffort);
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
      effectiveReasoningEffort,
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
    // One fluid gesture (owner smoothness decree 2026-07-22): the chips
    // fade, the pill grows, AND the caret lands at the end of the seeded
    // draft — armed here, executed by the auto-grow layout effect once the
    // controlled value has committed to the DOM.
    seedCaretRef.current = true;
  }, []);

  const draftEmpty = draft.trim().length === 0;
  const submitDisabled = draftEmpty || submitPending;
  // Stop acknowledged and the turn still in flight — the send key goes
  // inert and the chrome-row hint swaps to the STOPPING… label.
  const stopping = submitPending && stopRequested;

  // Approval echo — a mission run parked for approval reaches the composer as
  // `runStatus === "paused_approval"` (already in FREE_TEXT_DISALLOWED, so the
  // input is frozen). No new plumbing: this same signal recolors the pill's
  // traveling shimmer + border amber (via `data-vex-console-state`) and floats
  // the "AWAITING SIGNATURE" tag above the pill.
  const awaitingApproval = runStatus === "paused_approval";
  // Mission-mode placeholders stay owned by `placeholderFor`; the welcome /
  // agent default is the rotating crypto-utility set (`usePlaceholderRotator`).
  // Pause the rotator whenever a non-rotating override is visible so returning
  // from mission copy does not immediately jump to a hidden background tick.
  const rotatorPaused =
    focused || draft.length > 0 || activeSession?.mode === "mission";
  const welcomePlaceholder = usePlaceholderRotator(rotatorPaused);
  const placeholder =
    activeSession?.mode === "mission"
      ? placeholderFor(activeSession)
      : welcomePlaceholder;

  return (
    <>
      <div className="relative mt-6">
        {/* TRANSIENT SIGNAL TAG — floats above the pill's right side. An
         * approval pause wins over a requested stop. The active-work signal
         * lives on the agent avatar in the transcript, so the composer stays
         * visually quiet while a turn is running. */}
        {awaitingApproval ? (
          <span
            data-vex-console-status="approval"
            className="absolute -top-2.5 right-6 z-20 rounded-full border border-[var(--vex-pin-border)] bg-[var(--vex-surface-1)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--vex-pin)]"
          >
            AWAITING SIGNATURE
          </span>
        ) : stopping ? (
          // Exact "Stopping…" text — the stop-acknowledgment contract pinned by
          // the composer stop test (source casing stays).
          <span
            data-vex-console-status="stopping"
            className="absolute -top-2.5 right-6 z-20 rounded-full border border-[var(--vex-line-strong)] bg-[var(--vex-surface-1)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--vex-text-2)]"
          >
            Stopping…
          </span>
        ) : null}

        <form
          ref={formRef}
          onSubmit={onSubmit}
          data-vex-area="chat-composer"
          data-vex-console-state={awaitingApproval ? "approval" : "input"}
          className={cn(
            // THE SIGNAL CONSOLE PILL — one translucent glass row floating over
            // the Eclipse backdrop, Grok geometry (owner decree 2026-07-21):
            // truly rounded-full at the resting single-line height, relaxing
            // to rounded-[28px] once the field grows multiline so the stadium
            // curve never cuts into the draft (.vex-console eases the swap).
            // The glass surface + backdrop-blur are the owner-sanctioned THIRD
            // glass surface (shell-design-guard whitelist). The ring is QUIET
            // AT REST — one flat --vex-line hairline; the traveling accent
            // arc wakes ONLY on focus-within (with the --vex-glass-strong
            // step) and in the amber approval state — all owned by
            // `.vex-console` (globals.css) so no resting-glow shadow lands in
            // a className. `items-center`: the round send shares the field's
            // height, so the resting single-line row reads perfectly level (a
            // tall multiline field centers it — the deliberate trade-off).
            "vex-console relative flex items-center gap-1.5 overflow-visible bg-[var(--vex-glass)] p-1.5 backdrop-blur-xl",
            multiline ? "rounded-[28px]" : "rounded-full",
          )}
        >
          {/* The summoning ritual: typing "hypervexing" ripples the pill in
           * the protocol's mint before the message is even sent. Only outside
           * the mode — inside, the room itself is the acknowledgment. */}
          <HypervexingSummon active={summonActive} />
          {/* FIELD + FAUX PLACEHOLDER — one relative slot. The rotating
           * prompt renders as an aria-hidden overlay (a native placeholder
           * attribute cannot animate): each keyed phrase crossfades in with
           * a slight upward drift (~300ms, EASE_STANDARD) while the
           * outgoing one drifts up and out — AnimatePresence with
           * transform/opacity only (MOTION-POLICY safe). The overlay shows
           * exactly when a native placeholder would (empty draft; the
           * rotator itself freezes while the field is focused or holding
           * text — `rotatorPaused` below), is click-transparent, and the
           * field keeps its aria-label accessible name. The overlay's
           * pl-5/py-[9px]/16px metrics MIRROR the textarea's so the faux
           * prompt sits exactly on the caret line. The slot wears
           * `.vex-composer-grow` (globals.css): the auto-grow layout effect
           * mirrors the textarea's measured height onto it as a TRANSITIONED
           * px value, so the pill glides through grow/shrink on the same
           * curve as its radius relax instead of snapping. */}
          <div ref={fieldSlotRef} className="vex-composer-grow relative min-w-0 flex-1">
            {draft.length === 0 ? (
              <span
                aria-hidden
                data-vex-composer-placeholder
                className="pointer-events-none absolute inset-0 overflow-hidden text-[16px] leading-[1.6] text-[var(--vex-text-3)]"
              >
                <AnimatePresence initial={false}>
                  <motion.span
                    key={placeholder}
                    className="absolute inset-0 truncate py-[9px] pl-5 pr-1"
                    initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={
                      reducedMotion
                        ? { opacity: 0, transition: { duration: 0 } }
                        : { opacity: 0, y: -8 }
                    }
                    transition={{ duration: 0.3, ease: EASE_STANDARD }}
                  >
                    {placeholder}
                  </motion.span>
                </AnimatePresence>
              </span>
            ) : null}
            <textarea
              ref={textareaRef}
              value={draft}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
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
              aria-label="Session draft"
              // The summoning word is real vocabulary here, not a typo — the
              // spellchecker's red squiggle would deface the ritual.
              spellCheck={!summonActive}
              className={cn(
                "block w-full resize-none overflow-y-auto bg-transparent leading-[1.6] text-foreground caret-[var(--vex-accent)] outline-none",
                // Grok slim-stadium geometry (owner correction 2026-07-21
                // round 2): ONE 16px variant for welcome AND session; the
                // vertical padding builds the resting single-line height
                // (25.6px line + 2×9px ≈ 44px → 56px pill with the form's
                // p-1.5) instead of a min-height, so the caret line and the
                // faux placeholder always share the same origin.
                "max-h-[200px] py-[9px] pr-1 text-[16px]",
                // Left inset: the pill's own breathing room now the "+" is
                // retired, so the order text is not jammed on the rounded edge.
                "pl-5",
                // The invocation glows: draft text paints as a drifting
                // mint→teal gradient while the summoning word is present.
                summonActive && "hv-summon-input",
              )}
            />
          </div>

          {/* RIGHT CLUSTER — the quiet reasoning-effort selector + the round
           * send/stop control (owner decree 2026-07-21: attach and mic stay
           * excluded). Vertically centered against the field so the resting
           * row reads level. */}
          <div className="flex shrink-0 items-center gap-1.5">
              {/* REASONING SELECT — the Grok "Szybki ⌄" slot, LEFT of the
               * round key (D4): mounts ONLY for an agent-stage session whose
               * model reports a normalized capability; mission sessions
               * never see it (their ingress ignores the option). While the
               * global models query is still unresolved, a quiet inert
               * placeholder fills the same box instead (no reflow once it
               * settles either way) — Send stays enabled the whole time. */}
              {/* PROVIDER BRAND MARK — the model's @thesvg mark (the
               * SessionRuntimeBar treatment) seated LEFT of the effort slot
               * on both stages; decorative, the model id rides the title. */}
              {globalModelId !== null && reasoningStageIsAgent ? (
                <span
                  aria-hidden
                  data-vex-model-brand={globalModelId}
                  title={globalModelId}
                  className="inline-flex shrink-0 items-center opacity-70"
                >
                  <ModelBrandIcon modelId={globalModelId} size={16} />
                </span>
              ) : null}
              {reasoningCapability !== null &&
              reasoningStageIsAgent &&
              effectiveReasoningEffort !== null ? (
                <ReasoningEffortSelect
                  capability={reasoningCapability}
                  value={effectiveReasoningEffort}
                  onChange={handleReasoningPick}
                />
              ) : reasoningStageIsAgent && !modelsResolved ? (
                <ReasoningEffortPlaceholder />
              ) : null}
              {/* THE SEND CONTROL — three hard-cut states in one round slot. */}
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
                    <HugeiconsIcon icon={StopCircleIcon} size={16} aria-hidden />
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
                    <HugeiconsIcon icon={StopCircleIcon} size={16} aria-hidden />
                  </button>
                )
              ) : (
                <button
                  type="submit"
                  disabled={submitDisabled}
                  aria-label="Send message"
                  className={cn(
                    SEND_KEY_BASE,
                    // Ghost hairline circle while the field is empty; solid
                    // accent fill with the accent-contrast glyph once there is
                    // an order to send.
                    submitDisabled
                      ? "border-[var(--vex-line-strong)] bg-transparent text-[var(--vex-text-3)]"
                      : "border-transparent bg-[var(--vex-accent)] text-[var(--vex-accent-contrast)] hover:bg-[var(--vex-accent-hover)] active:scale-[0.96]",
                  )}
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden />
                </button>
              )}
          </div>
        </form>
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

      {/* STARTER CHIPS — detached below the pill, and gone WHILE THE USER IS
       * TYPING (owner decree 2026-07-21): any draft content fades/scales the
       * row out; clearing the field brings it back. The row lives inside a
       * FIXED-HEIGHT slot that stays mounted for the whole welcome/idle
       * stage, so the chips' unmount can never reflow the centered column —
       * the input does not jump (owner report 2026-07-21 round 2). h-[60px]
       * = the glass band (~44px) + its mt-4. AnimatePresence with
       * transform/opacity only (MOTION-POLICY: `layout`/`layoutId` are
       * banned under CSP style-src 'self'); `initial={false}` leaves the
       * stage load-in to the chips' own one-shot .vex-rise choreography.
       * Reduced motion: instant add/remove, no tween. */}
      {showQuickActions ? (
        <div className="h-[60px]">
          <AnimatePresence initial={false}>
            {draft.length === 0 ? (
              <motion.div
                key="starter-chips"
                initial={
                  reducedMotion ? false : { opacity: 0, scale: 0.97, y: 4 }
                }
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={
                  reducedMotion
                    ? { opacity: 0, transition: { duration: 0 } }
                    : { opacity: 0, scale: 0.97, y: 4 }
                }
                transition={{ duration: 0.16, ease: EASE_STANDARD }}
              >
                <ComposerQuickActions onPick={applyQuickAction} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </>
  );
}
