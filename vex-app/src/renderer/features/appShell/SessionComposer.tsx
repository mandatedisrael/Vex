/**
 * Session composer (puzzle 04 phase 7 extract).
 *
 * Owns:
 *   - textarea + auto-grow + send button,
 *   - mission-run-status gating on free-text submit,
 *   - composer notice (success / error / inline Retry on a retryable error),
 *   - quick-action chips (hidden in mission mode — replaced by the
 *     mission contract card the parent renders).
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
import { ArrowUp01Icon, StopCircleIcon } from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useSubmitChat } from "../../lib/api/chat.js";
import {
  flattenTranscriptPages,
  useTranscriptInfinite,
} from "../../lib/api/messages.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
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
}

export function SessionComposer({
  activeSession,
  activeSessionId,
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
  const handedOffRef = useRef<string | null>(null);
  const runtimeQuery = useRuntimeState(sessionId);

  const [draft, setDraft] = useState<string>("");
  const [notice, setNotice] = useState<ComposerNotice>(null);
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
        const outcome = await submitTurn({ sessionId: targetSessionId, message });
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
    [sessionId, submitTurn, activeSession],
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

  const submitDisabled = draft.trim().length === 0 || submitPending;

  return (
    <>
      <div className="mt-6">
        <form
          ref={formRef}
          onSubmit={onSubmit}
          data-vex-area="chat-composer"
          className="overflow-hidden rounded-3xl border border-[#3275f8]/38 bg-[#061026]/66 shadow-[0_0_54px_rgba(30,78,210,0.16)] backdrop-blur-2xl"
        >
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
            placeholder={placeholderFor(activeSession)}
            aria-label="Session draft"
            className={cn(
              "block w-full resize-none overflow-y-auto bg-transparent px-5 pt-3.5 pb-2 text-base leading-7 text-foreground outline-none",
              "min-h-[52px] max-h-[200px]",
              "placeholder:text-[var(--color-text-muted)]",
            )}
          />

          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
            <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
              <span className="truncate">
                {sessionId === null
                  ? "type a message to start a session"
                  : "Enter to send · Shift+Enter for a newline"}
              </span>
              {submitPending ? (
                <span role="status" className="ml-2 hidden text-[#8da5ff] sm:inline">
                  Working…
                </span>
              ) : null}
            </div>

            {submitPending ? (
              <button
                type="button"
                onClick={() => stopTurn()}
                aria-label="Stop generating"
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-full bg-[#3758ff] text-white shadow-[0_0_28px_rgba(55,88,255,0.36)] transition-colors hover:bg-[#4668ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8da5ff]"
              >
                <HugeiconsIcon icon={StopCircleIcon} size={20} aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitDisabled}
                aria-label="Send message"
                className="flex h-10 w-12 shrink-0 items-center justify-center rounded-full bg-[#3758ff] text-white shadow-[0_0_28px_rgba(55,88,255,0.36)] transition-colors hover:bg-[#4668ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8da5ff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} size={20} aria-hidden />
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
              notice.tone === "error" ? "text-destructive" : "text-[#8da5ff]"
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
              className="inline-flex h-6 shrink-0 items-center rounded-md border border-[#3275f8]/40 bg-[#3275f8]/10 px-2 font-medium text-[#9bb2ff] transition-colors hover:bg-[#3275f8]/16 hover:text-[#bcccff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8] disabled:cursor-not-allowed disabled:opacity-50"
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
