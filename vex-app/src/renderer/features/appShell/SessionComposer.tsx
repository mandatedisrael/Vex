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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  BitcoinWalletIcon,
  BridgeIcon,
  ChartCandlestickIcon,
  Exchange01Icon,
  Knowledge01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { useSubmitChat } from "../../lib/api/chat.js";
import { useMissionDraft } from "../../lib/api/mission.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
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
} from "./composer-helpers.js";
import { parseSlashCommand } from "./slash/parser.js";
import { useSlashCommandDispatch } from "./slash/dispatch.js";
import { useSlashMenu } from "./slash/use-slash-menu.js";
import type { SlashCommand } from "./slash/types.js";
import { SlashCommandMenu } from "./SlashCommandMenu.js";

interface QuickAction {
  readonly label: string;
  readonly prompt: string;
  readonly icon: IconSvgElement;
}

const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Swap",
    prompt:
      "Swap USDC to ETH with tight slippage and explain the route before execution.",
    icon: Exchange01Icon,
  },
  {
    label: "Bridge",
    prompt:
      "Bridge funds to Base and check fees before proposing the transaction.",
    icon: BridgeIcon,
  },
  {
    label: "Open position",
    prompt:
      "Open a small BTC perp position only after risk and liquidation checks.",
    icon: ChartCandlestickIcon,
  },
  {
    label: "Research token",
    prompt: "Research $TAO and summarize catalysts, liquidity, and on-chain risk.",
    icon: Search01Icon,
  },
  {
    label: "Portfolio check",
    prompt: "Check portfolio exposure across chains and flag urgent risks.",
    icon: BitcoinWalletIcon,
  },
  {
    label: "Save knowledge",
    prompt:
      "Save the current MEV protection notes into the local knowledge base.",
    icon: Knowledge01Icon,
  },
];

type ComposerNotice =
  | { readonly tone: "info" | "error"; readonly text: string }
  | null;

interface PendingConfirm {
  readonly command: SlashCommand;
}

export interface SessionComposerProps {
  readonly activeSession: SessionListItem | null;
}

export function SessionComposer({
  activeSession,
}: SessionComposerProps): JSX.Element {
  const sessionId = activeSession?.id ?? null;
  const submitChat = useSubmitChat();
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

  const [draft, setDraft] = useState<string>("");
  const [notice, setNotice] = useState<ComposerNotice>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashMenu = useSlashMenu({ draft, setDraft, textareaRef });

  useLayoutEffect((): void => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

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
      if (message.length === 0 || activeSession === null) return;
      setNotice(null);

      const parsed = parseSlashCommand(message);
      if (parsed.kind === "unknown") {
        setNotice({
          tone: "error",
          text: `Unknown command: ${parsed.raw}. Try /mission start, /rewind <N>, /restore, /mission-renew.`,
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
      if (submitChat.isPending) return;
      const outcome = await submitChat.mutateAsync({
        sessionId: activeSession.id,
        message,
      });
      if (!outcome.ok) {
        setNotice({ tone: "error", text: outcome.error.message });
        return;
      }
      setDraft("");
      setNotice({
        tone: "info",
        text:
          outcome.data.text ??
          (outcome.data.treatedAsInitialGoal
            ? "Mission goal received."
            : "Message sent."),
      });
    },
    [activeSession, draft, dispatchSlash, freeTextGate, runStatus, submitChat],
  );

  const applyQuickAction = useCallback((prompt: string): void => {
    setDraft(prompt);
    setNotice(null);
  }, []);

  const submitDisabled =
    draft.trim().length === 0 ||
    activeSession === null ||
    submitChat.isPending ||
    slashDispatch.pending;

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
          onKeyDown={slashMenu.handleKeyDown}
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
              {activeSession === null
                ? "select a session first"
                : "type /mission start, /rewind <N>, /restore, /mission-renew"}
            </span>
            {submitChat.isPending || slashDispatch.pending ? (
              <span role="status" className="ml-2 hidden text-[#8da5ff] sm:inline">
                Working…
              </span>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={submitDisabled}
            aria-label="Send message"
            className="flex h-10 w-12 shrink-0 items-center justify-center rounded-full bg-[#3758ff] text-white shadow-[0_0_28px_rgba(55,88,255,0.36)] transition-colors hover:bg-[#4668ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8da5ff] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={20} aria-hidden />
          </button>
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
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => applyQuickAction(action.prompt)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/[0.18] px-3 text-xs text-[var(--color-text-secondary)] backdrop-blur-xl transition-colors hover:border-[#3275f8]/32 hover:bg-[#3275f8]/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
            >
              <HugeiconsIcon icon={action.icon} size={15} aria-hidden />
              {action.label}
            </button>
          ))}
        </div>
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
