/**
 * Shared row-strip placeholder used by the loading / error / empty states of
 * the session list. Collapses to an icon-only centered strip when the sidebar
 * is closed; shows the icon plus a truncating label when open.
 *
 * Extracted verbatim from `SessionRows.tsx`. Purely presentational.
 */

import type { JSX } from "react";
import { cn } from "../../../lib/utils.js";

export function ListPlaceholder({
  sidebarOpen,
  text,
  tone,
  icon,
}: {
  readonly sidebarOpen: boolean;
  readonly text: string;
  readonly tone?: "error";
  readonly icon: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-3 text-xs",
        tone === "error" ? "text-destructive" : "text-[var(--vex-text-2)]",
        !sidebarOpen && "justify-center px-0",
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      {sidebarOpen ? <p className="min-w-0 truncate">{text}</p> : null}
    </div>
  );
}
