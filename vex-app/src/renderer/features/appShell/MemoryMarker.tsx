/**
 * MemoryMarker — static inline recall indicator (stage 8-4). Rendered for an
 * assistant tool-call row that invoked `memory_recall` (per-session narrative
 * memory) or `knowledge_recall` (durable cross-session knowledge). The copy
 * stays distinct so cross-session knowledge is never mislabeled as session
 * memory; an unknown/missing recall tool falls back to neutral copy.
 *
 * Any assistant prose on the row is preserved below the indicator as plain
 * text (never markdown/HTML). Static by design — a persisted row has no
 * reliable "recalling…" state, so there is no animation. ≤8px radius.
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  BookOpen01Icon,
  Brain01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

interface RecallCopy {
  readonly label: string;
  readonly icon: IconSvgElement;
}

function recallCopy(toolName: string | null): RecallCopy {
  switch (toolName) {
    case "memory_recall":
      return { label: "Recalled session memory", icon: Brain01Icon };
    case "knowledge_recall":
      return {
        label: "Recalled cross-session knowledge",
        icon: BookOpen01Icon,
      };
    default:
      return { label: "Recalled context", icon: SparklesIcon };
  }
}

export function MemoryMarker({
  toolName,
  content,
}: {
  readonly toolName: string | null;
  readonly content: string;
}): JSX.Element {
  const { label, icon } = recallCopy(toolName);
  return (
    <div
      data-vex-message-role="system"
      data-vex-marker="recall"
      className="flex justify-start"
    >
      <div className="flex max-w-[80%] flex-col gap-1 rounded-md border border-white/[0.06] px-2.5 py-1.5 text-[11px]">
        <span className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          <HugeiconsIcon icon={icon} size={12} aria-hidden />
          <span>{label}</span>
        </span>
        {content.length > 0 ? (
          <span
            data-vex-marker-content=""
            className="whitespace-pre-wrap break-words text-[var(--color-text-secondary)]"
          >
            {content}
          </span>
        ) : null}
      </div>
    </div>
  );
}
