/**
 * Sidebar brand + home control — the particle-constellation sigil crowns the
 * rail header as the SOLE mark (no logo + "VEX" wordmark). It is theme-aware
 * exactly like the welcome hero: `key={theme}` remounts `VexSigil` on a flip
 * so the one-shot assembly re-forms it into the Robinhood feather with the
 * lime palette (the component reads src/palette only at mount).
 *
 * Doubles as the "Back to welcome" control. When a session is open — or the
 * panel is showing a sub-view (library / memory) — the sigil is a real button
 * that clears the active session and returns the panel to the welcome stage.
 * On the welcome stage itself (no session AND the default session view) there
 * is nowhere to navigate to, so it renders as an inert decorative mark: the
 * button semantics only exist when the action does something.
 *
 * Performance: this is a SECOND live `VexSigil` canvas (the hero mounts the
 * first). VexSigil is DPR-capped (≤1.5), band-limited (≤3000 particles) and
 * idles on an ~8fps shimmer — all of its animation state is scoped inside one
 * effect (no module-level mutable state), so the two instances never fight.
 */

import type { JSX } from "react";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";
import {
  ROBINHOOD_SIGIL_PALETTE,
  ROBINHOOD_SIGIL_SRC,
  VexSigil,
} from "./VexSigil.js";

export function SidebarHomeSigil({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  const theme = useUiStore((s) => s.theme);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const appShellView = useUiStore((s) => s.appShellView);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);

  // Already on the welcome stage → the sigil is an inert mark, not a button.
  const onWelcome = activeSessionId === null && appShellView === "session";

  // Height-driven size; VexSigil keeps the monogram's square aspect, so the
  // crown fills the header when open and stays a compact mark when collapsed.
  const sizeClass = sidebarOpen ? "h-16" : "h-9";

  const sigil =
    theme === "robinhood" ? (
      <VexSigil
        key={theme}
        className={sizeClass}
        src={ROBINHOOD_SIGIL_SRC}
        palette={ROBINHOOD_SIGIL_PALETTE}
      />
    ) : (
      <VexSigil key={theme} className={sizeClass} />
    );

  if (onWelcome) {
    return <div className="flex items-center justify-center">{sigil}</div>;
  }

  return (
    <button
      type="button"
      aria-label="Back to welcome"
      onClick={() => {
        setActiveSessionId(null);
        setAppShellView("session");
      }}
      className={cn(
        "flex items-center justify-center rounded-xl p-1 transition-colors",
        "hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-surface-1)]",
      )}
    >
      {sigil}
    </button>
  );
}
