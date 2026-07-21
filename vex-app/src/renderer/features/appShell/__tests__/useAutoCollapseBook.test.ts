/**
 * useAutoCollapseBook — the BOOK panel's two one-way collapse edges.
 *
 * Pins:
 *   - VIEWPORT edge (existing behavior): mounting inside the narrow band
 *     collapses once, and a wide→narrow `change` crossing collapses; the
 *     narrow→wide crossing never reopens,
 *   - STAGE edge (welcome redesign): welcome→session while ALREADY below
 *     the breakpoint collapses ONCE (the floating welcome tab costs the
 *     center nothing; the session rail's 320px does) — at a wide viewport
 *     the same transition is a no-op,
 *   - neither edge fights the user: re-opening after a collapse sticks
 *     until the NEXT crossing/transition, and returning to welcome never
 *     collapses.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUiStore } from "../../../stores/uiStore.js";
import { useAutoCollapseBook } from "../useAutoCollapseBook.js";

const SESSION = "00000000-0000-4000-8000-00000000aaaa";

type MediaListener = (event: { matches: boolean }) => void;

const realMatchMedia = window.matchMedia;

let narrowMatches = false;
const listeners = new Set<MediaListener>();

/** Controllable matchMedia stub: `narrowMatches` drives `.matches`, and
 * `fireViewportChange` replays a breakpoint crossing to subscribers. */
function stubMatchMedia(): void {
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return narrowMatches;
      },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: MediaListener) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: MediaListener) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function fireViewportChange(matches: boolean): void {
  narrowMatches = matches;
  act(() => {
    for (const listener of listeners) listener({ matches });
  });
}

function bookOpen(): boolean {
  return useUiStore.getState().bookOpen;
}

beforeEach(() => {
  window.localStorage.clear();
  narrowMatches = false;
  listeners.clear();
  stubMatchMedia();
  useUiStore.setState({ bookOpen: true, activeSessionId: null });
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("useAutoCollapseBook — viewport edge (pinned existing behavior)", () => {
  it("collapses once when mounted inside the narrow band", () => {
    narrowMatches = true;
    renderHook(() => useAutoCollapseBook());
    expect(bookOpen()).toBe(false);
  });

  it("collapses on the wide→narrow crossing; the narrow→wide crossing never reopens", () => {
    renderHook(() => useAutoCollapseBook());
    expect(bookOpen()).toBe(true);

    fireViewportChange(true);
    expect(bookOpen()).toBe(false);

    fireViewportChange(false);
    expect(bookOpen()).toBe(false);
  });
});

describe("useAutoCollapseBook — stage edge (welcome → session)", () => {
  it("collapses ONCE on welcome→session below the breakpoint, and the user can reopen", () => {
    narrowMatches = true;
    renderHook(() => useAutoCollapseBook());
    // Mount-in-narrow collapsed; the user reopens the floating welcome tab.
    act(() => {
      useUiStore.getState().setBookOpen(true);
    });
    expect(bookOpen()).toBe(true);

    // Entering a session materializes the 320px rail → collapse once.
    act(() => {
      useUiStore.getState().setActiveSessionId(SESSION);
    });
    expect(bookOpen()).toBe(false);

    // The reopen sticks — the edge is one-way, never continuously enforced.
    act(() => {
      useUiStore.getState().setBookOpen(true);
    });
    expect(bookOpen()).toBe(true);
  });

  it("does NOT collapse on welcome→session at a wide viewport", () => {
    renderHook(() => useAutoCollapseBook());
    expect(bookOpen()).toBe(true);

    act(() => {
      useUiStore.getState().setActiveSessionId(SESSION);
    });
    expect(bookOpen()).toBe(true);
  });

  it("never collapses on session→welcome, but acts again on the NEXT welcome→session entry", () => {
    narrowMatches = true;
    renderHook(() => useAutoCollapseBook());
    // Enter a session (stage edge collapses), then the user reopens.
    act(() => {
      useUiStore.getState().setActiveSessionId(SESSION);
    });
    act(() => {
      useUiStore.getState().setBookOpen(true);
    });

    // Back to welcome: the floating tab costs nothing → no collapse.
    act(() => {
      useUiStore.getState().setActiveSessionId(null);
    });
    expect(bookOpen()).toBe(true);

    // The next welcome→session transition is a fresh edge.
    act(() => {
      useUiStore.getState().setActiveSessionId(SESSION);
    });
    expect(bookOpen()).toBe(false);
  });
});
