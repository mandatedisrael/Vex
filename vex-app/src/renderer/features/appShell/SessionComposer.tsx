/**
 * Session composer (puzzle 04 phase 7 extract).
 *
 * Owns:
 *   - textarea + auto-grow + send button,
 *   - slash command parser routing,
 *   - confirmation dialog for destructive commands,
 *   - mission-run-status gating on free-text submit,
 *   - composer notice (success / error / blocked reasons),
 *   - quick-action chips (hidden in mission mode — replaced by the
 *     mission contract card the parent renders).
 *
 * Pure helpers (gating reasons, placeholders, confirm-dialog labels)
 * live in `composer-helpers.ts`; the dispatcher hook lives in
 * `slash/dispatch.ts`. This file owns React state + event routing.
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
import { useMissionDraft } from "../../lib/api/mission.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { ConfirmDestructiveDialog } from "./ConfirmDestructiveDialog.js";
import {
  FREE_TEXT_DISALLOWED,
  confirmDescription,
  confirmLabel,
  confirmTitle,
  confirmTone,
  gatedReason,
  placeholderFor,
  readRunStatus,
  submitSuccessText,
} from "./composer-helpers.js";
import { ComposerQuickActions } from "./ComposerQuickActions.js";
import { slashCommandList } from "./slash/catalog.js";
import { parseSlashCommand } from "./slash/parser.js";
import { useSlashCommandDispatch } from "./slash/dispatch.js";
import { useSlashMenu } from "./slash/use-slash-menu.js";
import type { SlashCommand } from "./slash/types.js";
import { SlashCommandMenu } from "./SlashCommandMenu.js";

type ComposerNotice =
  | { readonly tone: "info" | "error"; readonly text: string }
  | null;

interface PendingConfirm {
  readonly command: SlashCommand;
}

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
  const draftQuery = useMissionDraft(sessionId);
  const runtimeQuery = useRuntimeState(sessionId);
  const missionId = useMemo<string | null>(() => {
    if (!draftQuery.data?.ok) return null;
    return draftQuery.data.data?.missionId ?? null;
  }, [draftQuery.data]);
  const slashDispatch = useSlashCommandDispatch({
    sessionId: sessionId ?? "",
    missionId,
  });

  // Agent sessions (and the welcome state) hide mission-loop commands; the
  // menu, the under-input hint, and the unknown-command suggestion all key off
  // this so they advertise the same mode-appropriate set.
  const composerMode = activeSession?.mode ?? "agent";

  const [draft, setDraft] = useState<string>("");
  const [notice, setNotice] = useState<ComposerNotice>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const slashMenu = useSlashMenu({ draft, setDraft, textareaRef, mode: composerMode });

  useLayoutEffect((): void => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

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
    void (async () => {
      const outcome = await submitTurn({ sessionId, message });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: outcome.error.message });
        setDraft(message);
        return;
      }
      setNotice({ tone: "info", text: submitSuccessText(outcome.data) });
    })();
  }, [sessionId, pendingFirstMessage, clearPendingFirstMessage, submitTurn]);

  const runStatus = readRunStatus(runtimeQuery.data);
  const freeTextGate = runStatus !== null && FREE_TEXT_DISALLOWED.has(runStatus);
  const showQuickActions = activeSession?.mode !== "mission";

  const dispatchSlash = useCallback(
    async (command: SlashCommand): Promise<void> => {
      if (sessionId === null) {
        setNotice({ tone: "error", text: "Select a session first." });
        return;
      }
      const outcome = await slashDispatch.dispatch(command);
      if (outcome.kind === "success") {
        setDraft("");
        setNotice({ tone: "info", text: outcome.message });
      } else {
        // both `error` and `blocked` show as error-toned notices.
        setNotice({ tone: "error", text: outcome.message });
      }
    },
    [sessionId, slashDispatch],
  );

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
      // Enter can fire a submit even while a turn / slash dispatch is in flight
      // (requestSubmit() ignores the disabled Send button), so gate here before
      // any parsing or dispatch.
      if (submitPending || slashDispatch.pending) return;
      setNotice(null);

      const parsed = parseSlashCommand(message);
      if (parsed.kind === "unknown") {
        setNotice({
          tone: "error",
          text: `Unknown command: ${parsed.raw}. Try ${slashCommandList(composerMode)}.`,
        });
        return;
      }
      if (parsed.kind === "invalid") {
        setNotice({ tone: "error", text: parsed.reason });
        return;
      }
      if (parsed.kind === "ok") {
        if (parsed.requiresConfirm) {
          setPendingConfirm({ command: parsed.command });
          return;
        }
        await dispatchSlash(parsed.command);
        return;
      }
      // not-a-command → plain chat submit. Gate on mission run status.
      if (freeTextGate) {
        setNotice({ tone: "error", text: gatedReason(runStatus) });
        return;
      }
      // Clear optimistically — the message is on its way to the agent and the
      // transcript already shows it. On failure, restore the draft ONLY if the
      // user has not typed something new into the (now-empty) input.
      setDraft("");
      const outcome = await submitTurn({
        sessionId,
        message,
      });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: outcome.error.message });
        setDraft((cur) => (cur.length === 0 ? message : cur));
        return;
      }
      setNotice({ tone: "info", text: submitSuccessText(outcome.data) });
    },
    [
      sessionId,
      draft,
      dispatchSlash,
      freeTextGate,
      openCreateSession,
      runStatus,
      slashDispatch,
      submitPending,
      submitTurn,
      composerMode,
    ],
  );

  const applyQuickAction = useCallback((prompt: string): void => {
    setDraft(prompt);
    setNotice(null);
  }, []);

  const submitDisabled =
    draft.trim().length === 0 || submitPending || slashDispatch.pending;

  return (
    <>
      <div className="relative mt-6">
        <SlashCommandMenu
          open={slashMenu.open}
          items={slashMenu.items}
          activeIndex={slashMenu.activeIndex}
          listboxId={slashMenu.listboxId}
          getOptionId={slashMenu.getOptionId}
          onSelect={slashMenu.select}
          onActivate={slashMenu.setActiveIndex}
        />
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
            // Slash menu gets first refusal (arrows/Enter/Escape while open).
            slashMenu.handleKeyDown(event);
            // Enter sends; Shift+Enter and IME composition insert a newline. If
            // the menu consumed the key it already called preventDefault.
            if (
              !event.defaultPrevented &&
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
          aria-autocomplete="list"
          aria-expanded={slashMenu.open}
          aria-controls={slashMenu.open ? slashMenu.listboxId : undefined}
          aria-activedescendant={slashMenu.activeOptionId}
          className={cn(
            "block w-full resize-none overflow-y-auto bg-transparent px-5 pt-3.5 pb-2 text-base leading-7 text-foreground outline-none",
            "min-h-[52px] max-h-[200px]",
            "placeholder:text-[var(--color-text-muted)]",
          )}
        />

        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <span className="font-mono text-sm text-[#6f91ff]">/</span>
            <span className="truncate">
              {sessionId === null
                ? "type a message to start a session"
                : `type ${slashCommandList(composerMode)}`}
            </span>
            {submitPending || slashDispatch.pending ? (
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
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "mt-3 text-xs",
            notice.tone === "error" ? "text-destructive" : "text-[#8da5ff]",
          )}
        >
          {notice.text}
        </p>
      ) : null}

      {showQuickActions ? (
        <ComposerQuickActions onPick={applyQuickAction} />
      ) : null}

      <ConfirmDestructiveDialog
        open={pendingConfirm !== null}
        title={confirmTitle(pendingConfirm?.command)}
        description={confirmDescription(pendingConfirm?.command)}
        confirmLabel={confirmLabel(pendingConfirm?.command)}
        tone={confirmTone(pendingConfirm?.command)}
        pending={slashDispatch.pending}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={async () => {
          if (pendingConfirm === null) return;
          const command = pendingConfirm.command;
          setPendingConfirm(null);
          await dispatchSlash(command);
        }}
      />
    </>
  );
}
