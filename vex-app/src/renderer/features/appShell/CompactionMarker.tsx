/**
 * CompactionMarker — static inline timeline marker for a committed Track-1
 * compaction (stage 8-4). The engine writes a `compaction_committed` row;
 * this renders it as a centered, muted, non-animated notice so the chat
 * timeline shows where a compaction landed.
 *
 * It is NOT a live progress indicator — the live compaction state lives in
 * the SessionRuntimeBar chip (stage 7-1). A persisted row has no reliable
 * "in flight" state, so the marker is deliberately static (no dotmatrix).
 * ≤8px radius, no card-in-card.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive02Icon } from "@hugeicons/core-free-icons";

export function CompactionMarker({
  content,
}: {
  readonly content: string;
}): JSX.Element {
  const label =
    content.length > 0 ? content : "Conversation compacted into memory";
  return (
    <div
      data-vex-message-role="system"
      data-vex-marker="compaction"
      className="flex justify-center"
    >
      <div className="flex max-w-[80%] items-center gap-1.5 rounded-md border border-white/[0.06] px-2.5 py-1 text-[11px] text-[var(--color-text-muted)]">
        <HugeiconsIcon icon={Archive02Icon} size={12} aria-hidden />
        <span className="break-words">{label}</span>
      </div>
    </div>
  );
}
