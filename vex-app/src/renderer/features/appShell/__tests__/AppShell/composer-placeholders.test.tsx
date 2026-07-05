/**
 * Composer placeholder rotator (feat/robinhood-launch) — the rotating
 * welcome/agent placeholder that replaced the single static line. Pins the
 * `usePlaceholderRotator` mechanics WITHOUT any composer submit/gating:
 *
 *   - rotates through the six crypto-utility phrases on the ~6s interval while
 *     idle (not frozen), wrapping back to the first;
 *   - FREEZES on the current phrase while `frozen` is true (the composer passes
 *     field-focused OR non-empty draft) and resumes with a fresh read window;
 *   - renders the first phrase STATICALLY under prefers-reduced-motion (no
 *     interval);
 *   - pauses while the document is hidden and resumes on visibility.
 *
 * Fake timers per repo convention (mirrors SessionWelcomeHero.test.tsx): the
 * hook is driven directly via renderHook so the mechanics are isolated from
 * the composer's many effects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  PLACEHOLDER_ROTATE_MS,
  WELCOME_PLACEHOLDERS,
  usePlaceholderRotator,
} from "../../composer-placeholders.js";

type MatchMediaListener = (event: MediaQueryListEvent) => void;

/** Minimal matchMedia stub — mirrors SessionWelcomeHero.test.tsx. */
function installMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const matches = reduced && query.includes("prefers-reduced-motion: reduce");
      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: (_evt: string, _cb: MatchMediaListener) => undefined,
        removeEventListener: (_evt: string, _cb: MatchMediaListener) => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      } as MediaQueryList;
    },
  });
}

function removeMatchMedia(): void {
  delete (window as { matchMedia?: Window["matchMedia"] }).matchMedia;
}

/** Shadow document.hidden with an own getter (configurable → removable). */
function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

function restoreDocumentHidden(): void {
  delete (document as { hidden?: boolean }).hidden;
}

describe("usePlaceholderRotator", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  afterEach(() => {
    // Unmount under the same fake-timer regime that scheduled the interval so
    // cleanup calls the mocked clearInterval; then drop the environment shims.
    cleanup();
    vi.useRealTimers();
    removeMatchMedia();
    restoreDocumentHidden();
  });

  it("rotates through the six phrases on the interval when idle, then wraps", () => {
    const { result } = renderHook(() => usePlaceholderRotator(false));
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[0]);

    for (let i = 1; i < WELCOME_PLACEHOLDERS.length; i += 1) {
      act(() => {
        vi.advanceTimersByTime(PLACEHOLDER_ROTATE_MS);
      });
      expect(result.current).toBe(WELCOME_PLACEHOLDERS[i]!);
    }
    // …and wraps back around to the first.
    act(() => {
      vi.advanceTimersByTime(PLACEHOLDER_ROTATE_MS);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[0]);
  });

  it("freezes on the current phrase while frozen, then resumes on the same cadence", () => {
    const { result, rerender } = renderHook(
      ({ frozen }: { frozen: boolean }) => usePlaceholderRotator(frozen),
      { initialProps: { frozen: false } },
    );
    // Advance one tick while idle → phrase two.
    act(() => {
      vi.advanceTimersByTime(PLACEHOLDER_ROTATE_MS);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[1]);

    // Freeze (focus / non-empty draft) → the timer stops and the phrase never
    // advances.
    rerender({ frozen: true });
    act(() => {
      vi.advanceTimersByTime(3 * PLACEHOLDER_ROTATE_MS);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[1]);

    // Unfreeze → rotation resumes from where it paused, but with a full fresh
    // read window instead of an immediate hidden/background tick.
    rerender({ frozen: false });
    act(() => {
      vi.advanceTimersByTime(PLACEHOLDER_ROTATE_MS - 1);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[1]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[2]);
  });

  it("renders the first phrase statically under prefers-reduced-motion (no interval)", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePlaceholderRotator(false));
    act(() => {
      vi.advanceTimersByTime(3 * PLACEHOLDER_ROTATE_MS);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[0]);
  });

  it("pauses rotation while document.hidden and resumes on visibility", () => {
    const { result } = renderHook(() => usePlaceholderRotator(false));
    setDocumentHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(3 * PLACEHOLDER_ROTATE_MS);
    });
    // Hidden → no swaps happened.
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[0]);

    setDocumentHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(PLACEHOLDER_ROTATE_MS);
    });
    expect(result.current).toBe(WELCOME_PLACEHOLDERS[1]);
  });
});
