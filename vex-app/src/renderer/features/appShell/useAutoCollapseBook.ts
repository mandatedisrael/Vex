/**
 * Auto-collapse the BOOK panel on the two space-pressure edges. One hook,
 * one responsibility: reclaim the rail's 320px exactly when it would start
 * squeezing the center column, never fighting a manual choice.
 *
 * 1) VIEWPORT edge — the shell has four columns when a session is open: the
 *    sidebar (SessionsList) + the chat section + the MISSION RAIL (200px) +
 *    the BOOK panel (320px). Below ~1360px those four can no longer
 *    breathe, so when the viewport crosses INTO the narrow band we collapse
 *    BOOK.
 *
 * 2) STAGE edge (welcome → session, 2026-07-20 redesign) — on the welcome
 *    stage the BOOK is the in-flow Portfolio tab (`WelcomePortfolioPanel`;
 *    reserves width while open, but welcome has no MISSION RAIL and no
 *    chat column pressure). Opening a session swaps it for the 320px rail
 *    AND adds the session chrome around the center — if that happens while
 *    the viewport is ALREADY below the breakpoint, no `change` event
 *    fires, so we collapse ONCE on the welcome→session transition itself.
 *
 * Both edges are deliberately ONE-WAY on their transition, not a continuous
 * enforce:
 *   - crossing narrow → wide leaves BOOK as-is (we don't auto-reopen);
 *   - inside the narrow band the user can still manually re-open BOOK and we
 *     won't fight that — we only act again on the next wide→narrow crossing
 *     or the next welcome→session entry.
 *
 * Using the `change` event (not a render-time read) for the viewport edge
 * means a manual toggle does not retrigger the collapse; only an actual
 * breakpoint crossing does. The matchMedia guards mirror
 * `usePrefersReducedMotion` for jsdom safety.
 */

import { useEffect, useRef } from "react";
import { useUiStore } from "../../stores/uiStore.js";

/** Four columns stop fitting below this width (see the shell layout math). */
const NARROW_QUERY = "(max-width: 1359px)";

export function useAutoCollapseBook(): void {
  const setBookOpen = useUiStore((s) => s.setBookOpen);
  const activeSessionId = useUiStore((s) => s.activeSessionId);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const query = window.matchMedia(NARROW_QUERY);

    // Initial mount in the narrow band → collapse once.
    if (query.matches) setBookOpen(false);

    const onChange = (event: MediaQueryListEvent): void => {
      // Only the wide→narrow crossing collapses; the narrow→wide crossing is a
      // no-op so we never override a user's choice.
      if (event.matches) setBookOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [setBookOpen]);

  // Stage edge: the ONE welcome→session transition (null → non-null) while
  // already narrow. The ref starts at the mount value, so mounting straight
  // into a session never counts as a transition (the initial-mount branch
  // above already covered the narrow case).
  const previousSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    const previous = previousSessionIdRef.current;
    previousSessionIdRef.current = activeSessionId;
    if (previous !== null || activeSessionId === null) return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    if (window.matchMedia(NARROW_QUERY).matches) setBookOpen(false);
  }, [activeSessionId, setBookOpen]);
}
