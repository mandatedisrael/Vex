/**
 * Ephemeral streaming preview bubble (Stage 9-3).
 *
 * Renders the in-flight assistant turn (the `streamStore` preview) with the
 * same avatar + safe-markdown layout as a persisted assistant row, plus a
 * thinking indicator while streaming. It is replaced by the canonical message
 * DTO the moment the row is persisted (`useStreamPreviewSync` clears it), so
 * this is preview only — never the source of truth.
 *
 * Accessibility: the bubble is NOT a live region over the growing text (that
 * would spam screen readers token-by-token). Instead a visually-hidden
 * `role="status"` announces the phase ("Vex is responding" / error), which
 * changes at most a couple of times; the streamed text + indicator are
 * decorative (`aria-hidden`) — the canonical content is read from the
 * persisted transcript row.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Wrench01Icon } from "@hugeicons/core-free-icons";
import type { StreamPreview } from "../../stores/streamStore.js";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";

export function StreamingBubble({
  preview,
}: {
  readonly preview: StreamPreview;
}): JSX.Element {
  const showToolHint =
    preview.text.length === 0 &&
    preview.toolName !== null &&
    preview.phase !== "error";

  return (
    <div
      data-vex-area="stream-preview"
      data-vex-message-role="assistant"
      data-vex-stream-phase={preview.phase}
      aria-busy={preview.phase === "streaming"}
      className="flex items-start gap-2"
    >
      <img
        src="/vex.jpg"
        alt="Vex"
        className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-cover"
      />
      <div className="max-w-[80%] break-words rounded-lg bg-white/[0.04] px-3 py-2 text-sm leading-relaxed text-foreground">
        <span className="sr-only" role="status">
          {preview.phase === "error"
            ? "Vex stream error"
            : preview.phase === "done"
              ? "Vex responded"
              : "Vex is responding"}
        </span>
        {/* Block wrapper — MarkdownContent emits block elements (p/pre/lists)
            AND focusable <a> links, so this is a block element and is NOT
            aria-hidden (hiding focusable links from assistive tech is an
            aria-hidden-focus violation). It is not a live region, so the
            growing text is not announced token-by-token; the sr-only status
            above conveys the phase. */}
        <div>
          {preview.phase === "error" ? (
            <span className="text-[#f0a0a0]">Stream error</span>
          ) : showToolHint ? (
            <span
              data-vex-tool-state="preparing"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[var(--color-text-muted)]"
            >
              <HugeiconsIcon icon={Wrench01Icon} size={13} aria-hidden />
              Calling {preview.toolName}…
            </span>
          ) : (
            <MarkdownContent text={preview.text} />
          )}
        </div>
        {preview.phase === "streaming" ? (
          <div className="mt-1 flex" aria-hidden>
            <DotmHex3 size={14} dotSize={2} color="#6f91ff" animated />
          </div>
        ) : null}
      </div>
    </div>
  );
}
