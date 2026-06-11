/**
 * "Awaiting signature" stamp-link (S5). Rendered next to a tool act (or its
 * group header) whose `toolCallId` matches a PENDING approval. Clicking jumps
 * to the matching `ApprovalCard` (`[data-approval-id]`) and focuses it —
 * a sibling of the disclosure button, never nested inside it (nested buttons
 * are invalid HTML and break both contracts' aria semantics).
 *
 * The stamp is quiet by design: accent tone, no fill, no pulse — the card
 * itself is the place that asks for the pen.
 */

import type { JSX } from "react";
import { Stamp } from "../SessionRows/Stamp.js";

/**
 * Escape an approval id for the attribute selector. `CSS.escape` is the
 * platform answer but jsdom (the test env) does not define `CSS`; the
 * fallback escapes the only two characters that can break out of a
 * double-quoted attribute string.
 */
function escapeForSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Scroll to + focus the approval card. The card carries `tabIndex={-1}` so
 * programmatic focus lands on the region itself (screen readers announce it).
 * jsdom implements neither `scrollIntoView` nor `matchMedia`; both are
 * feature-checked so the link degrades to focus-only instead of throwing.
 */
function jumpToApproval(approvalId: string): void {
  const card = document.querySelector<HTMLElement>(
    `[data-approval-id="${escapeForSelector(approvalId)}"]`,
  );
  if (card === null) return;
  if (typeof card.scrollIntoView === "function") {
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }
  card.focus({ preventScroll: true });
}

export function ApprovalLinkStamp({
  approvalId,
}: {
  readonly approvalId: string;
}): JSX.Element {
  return (
    <button
      type="button"
      data-vex-approval-link={approvalId}
      aria-label="Awaiting signature — go to approval"
      onClick={() => jumpToApproval(approvalId)}
      className="shrink-0 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
    >
      <Stamp tone="accent">Awaiting signature</Stamp>
    </button>
  );
}
