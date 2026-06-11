/**
 * REASON control (S6) — per-session reasoning-effort selector, mounted in
 * the composer chrome row next to the PLAN switch and sharing its
 * instrument grammar (h-7 token chrome, mono 10px microtype).
 *
 * The parent renders it ONLY when the active model supports reasoning
 * (`sessions.getModel → supportsReasoning === true`), so this component
 * never has to model "unsupported". It is a CYCLE button, not a toggle:
 * each click advances low → medium → high → low. "medium" is the engine
 * default and shows quiet chrome; an explicit non-default level lights the
 * accent so a deviation from default is visible at a glance. The choice is
 * launch-ephemeral uiStore state — the engine, not the renderer, owns the
 * default.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiBrain05Icon } from "@hugeicons/core-free-icons";
import type { ReasoningEffort } from "@shared/schemas/chat.js";
import { cn } from "../../lib/utils.js";

/** Cycle order pinned by tests: low → medium → high → low. */
const EFFORT_CYCLE: readonly ReasoningEffort[] = ["low", "medium", "high"];

/** Short labels keep the chrome row dense — "medium" reads as "Med". */
const EFFORT_LABEL: Readonly<Record<ReasoningEffort, string>> = {
  low: "Low",
  medium: "Med",
  high: "High",
};

export function nextReasoningEffort(effort: ReasoningEffort): ReasoningEffort {
  const index = EFFORT_CYCLE.indexOf(effort);
  // indexOf can only miss on an out-of-contract value; restart the cycle.
  return EFFORT_CYCLE[(index + 1) % EFFORT_CYCLE.length] ?? "medium";
}

export interface ReasoningSwitchProps {
  readonly effort: ReasoningEffort;
  /** Real `disabled` while a chat turn is in flight. */
  readonly busy: boolean;
  readonly onCycle: () => void;
}

export function ReasoningSwitch({
  effort,
  busy,
  onCycle,
}: ReasoningSwitchProps): JSX.Element {
  // "medium" is the engine default → quiet chrome; any explicit deviation
  // (low/high) gets the accent treatment so the operator sees the override.
  const nonDefault = effort !== "medium";
  return (
    <button
      type="button"
      aria-label={`Reasoning effort: ${effort}`}
      title={`Reasoning effort: ${effort} — click to cycle (low → medium → high)`}
      data-vex-reasoning-effort={effort}
      disabled={busy}
      onClick={onCycle}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-[160ms]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        "disabled:cursor-not-allowed",
        nonDefault
          ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-8)] text-[var(--vex-accent-text)]"
          : "border-[var(--vex-line-strong)] text-[var(--vex-text-3)]",
      )}
    >
      <HugeiconsIcon icon={AiBrain05Icon} size={13} aria-hidden />
      Reason · {EFFORT_LABEL[effort]}
    </button>
  );
}
