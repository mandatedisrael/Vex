/**
 * One transcript row — presentational only (S3 ledger-document anatomy,
 * S5 act ledger).
 *
 * Switches on the pure `TranscriptEntry.variant`. The transcript reads as
 * an asymmetric register: USER turns are compact right-aligned cards with a
 * persistent "You · HH:MM" caption; ASSISTANT turns are full-width document
 * flow hung off the Signal Tape spine by a quiet node in a 28px gutter (no
 * bubble, no avatar — the shell is photo-free; accent is rationed to the
 * live/pending node, so a settled node rests in --vex-text-3). Assistant prose
 * renders through
 * `MarkdownContent` (stage 8-2a) — safe React elements, never an HTML
 * string; user/tool/notice rows + the `compaction`/`recall` markers (stage
 * 8-4) render as plain React text nodes. Either way model/tool output cannot
 * inject markup.
 */

import type { JSX, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { StopCircleIcon } from "@hugeicons/core-free-icons";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import { cn } from "../../lib/utils.js";
import { CompactionMarker } from "./CompactionMarker.js";
import { MemoryMarker } from "./MemoryMarker.js";
import { ToolActRow } from "./ToolLedger/ToolActRow.js";
import { ToolGroupRow } from "./ToolLedger/ToolGroupRow.js";
import { ToolDisclosure } from "./ToolDisclosure.js";
import type {
  ToolCallActView,
  TranscriptEntry,
  TranscriptRowModel,
} from "./transcriptRowModel.js";

/**
 * HH:MM in the user's local time — the register caption is a clock entry,
 * not a full date. Returns null for an unparseable timestamp so the caption
 * degrades to the speaker name alone instead of printing "NaN:NaN".
 */
function formatClock(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function captionText(who: string, createdAt: string): string {
  const clock = formatClock(createdAt);
  return clock === null ? who : `${who} · ${clock}`;
}

/**
 * A settled entry's node on the Signal Tape spine (the monotonic time axis the
 * transcript hangs off, drawn once in SessionTranscript). Quiet at rest — accent
 * is rationed to the live/pending node — and centered on the spine x (left-[9px])
 * with a canvas-colored ring so the spine reads as passing cleanly around it.
 */
function TapeNode(): JSX.Element {
  return (
    <span
      aria-hidden
      className="absolute left-[6px] top-[5px] h-1.5 w-1.5 rounded-[1.5px] bg-[var(--vex-text-3)] ring-2 ring-[var(--vex-surface-0)]"
    />
  );
}

/** Persistent "Vex · HH:MM" caption above an assistant document block. */
function AssistantCaption({
  createdAt,
}: {
  readonly createdAt: string;
}): JSX.Element {
  return (
    <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.14em] tabular-nums text-[var(--vex-text-2)]">
      {captionText("Vex", createdAt)}
    </span>
  );
}

/** Document-typography wrapper around the safe markdown renderer. */
function AssistantBody({ content }: { readonly content: string }): JSX.Element {
  return (
    <div className="break-words text-[15px] leading-[1.7] text-foreground">
      <MarkdownContent text={content} />
    </div>
  );
}

export function TranscriptMessage({
  row,
  pendingApprovals,
}: {
  readonly row: TranscriptEntry;
  /**
   * toolCallId → PENDING approval id for the active session (S5). Acts whose
   * call id matches get the "Awaiting signature" stamp-link to their card.
   */
  readonly pendingApprovals?: ReadonlyMap<string, string>;
}): JSX.Element {
  switch (row.variant) {
    case "user":
      return (
        <div data-vex-message-role="user" className="flex flex-col items-end">
          <div className="max-w-[70%] whitespace-pre-wrap break-words rounded-lg border border-[var(--vex-line-strong)] bg-white/[0.04] px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            {row.content}
          </div>
          <span className="mt-1 block text-right font-mono text-[10px] uppercase tabular-nums text-[var(--vex-text-2)]">
            {captionText("You", row.createdAt)}
          </span>
        </div>
      );
    case "assistant":
      return (
        <div data-vex-message-role="assistant" className="relative pl-7">
          <TapeNode />
          <AssistantCaption createdAt={row.createdAt} />
          <AssistantBody content={row.content} />
        </div>
      );
    case "assistant_stopped":
      return (
        <div
          data-vex-message-role="assistant"
          data-vex-stopped=""
          className="relative pl-7"
        >
          <TapeNode />
          <AssistantCaption createdAt={row.createdAt} />
          <AssistantBody content={row.content} />
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--vex-text-3)]">
            <HugeiconsIcon icon={StopCircleIcon} size={12} aria-hidden />
            <span>Stopped</span>
          </div>
        </div>
      );
    case "tool":
      // S5 — THE ACT LEDGER. Orphan results (no call paired in their run)
      // keep the standalone disclosure; call rows register one ToolActRow per
      // executed call. The assistant prose keeps the S3 document anatomy.
      if (row.toolKind === "result") {
        return (
          <div data-vex-message-role="tool" className="flex justify-start">
            <div className="flex w-full max-w-[80%] flex-col gap-1.5">
              <ToolDisclosure
                label={row.label ?? "tool_output"}
                body={row.content}
                emptyHint="(no output)"
              />
            </div>
          </div>
        );
      }
      return (
        <div data-vex-message-role="tool" className="flex flex-col gap-1.5">
          {/* Assistant prose accompanying the tool call (often empty). */}
          {row.content.length > 0 ? (
            <div className="relative pl-7">
              <TapeNode />
              <AssistantCaption createdAt={row.createdAt} />
              <AssistantBody content={row.content} />
            </div>
          ) : null}
          {/* One registered act per executed call — collapsed by default. */}
          {resolveActs(row).map((act) => (
            <ToolActRow
              key={act.toolCallId}
              act={act}
              pendingApprovalId={pendingApprovals?.get(act.toolCallId) ?? null}
            />
          ))}
        </div>
      );
    case "tool_group":
      return <ToolGroupRow group={row} pendingApprovals={pendingApprovals} />;
    case "notice":
      return (
        <div data-vex-message-role="system" className="flex justify-center">
          <NoticeBody tone={row.noticeTone ?? "runtime"}>
            {row.content}
          </NoticeBody>
        </div>
      );
    case "compaction":
      return <CompactionMarker content={row.content} />;
    case "recall":
      return <MemoryMarker toolName={row.label} content={row.content} />;
    default: {
      const exhaustive: never = row.variant;
      throw new Error(`Unhandled transcript variant: ${String(exhaustive)}`);
    }
  }
}

/**
 * Acts for a call row. Rows that went through `groupTranscriptRows` carry
 * `toolActs` (outputs merged); rows rendered directly from `toTranscriptRows`
 * fall back to the raw call displays with no output.
 */
function resolveActs(row: TranscriptRowModel): readonly ToolCallActView[] {
  if (row.toolActs !== undefined) return row.toolActs;
  return (row.toolCalls ?? []).map((call) => ({ ...call, output: null }));
}

/**
 * Runtime/error notice — the marker mono grammar without hairlines. Error
 * notices carry the destructive tone with the one sanctioned fill (danger/10).
 */
function NoticeBody({
  tone,
  children,
}: {
  readonly tone: "runtime" | "error";
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={cn(
        "max-w-[80%] whitespace-pre-wrap break-words rounded-[6px] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.28em]",
        tone === "error"
          ? "border border-[color-mix(in_oklab,var(--color-destructive)_40%,transparent)] bg-destructive/10 text-destructive"
          : "bg-white/[0.03] text-[var(--vex-text-3)]",
      )}
    >
      {children}
    </div>
  );
}
