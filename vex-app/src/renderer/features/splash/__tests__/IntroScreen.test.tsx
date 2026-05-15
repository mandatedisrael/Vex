/**
 * Tests for the Vex intro screen. Verifies:
 *   1. Initial render — progressbar present, Begin button absent.
 *   2. After loader duration — progressbar reaches 100, Begin appears.
 *   3. Click Begin — onComplete called exactly once.
 *   4. prefers-reduced-motion — Begin visible immediately, still requires click.
 *   5. Unmount before completion — no onComplete call, no late progress.
 *
 * Plan: codex review round 1, 5-point minimal assertion set.
 * Matchers: plain Vitest/Chai (no `@testing-library/jest-dom`) to match
 * the convention in `components/ui/__tests__/tabs.test.tsx`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { IntroScreen } from "../IntroScreen.js";

type MatchMediaListener = (event: MediaQueryListEvent) => void;

function installMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const matches =
        reduced && query.includes("prefers-reduced-motion: reduce");
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

describe("IntroScreen", () => {
  beforeEach(() => {
    // Fake setTimeout/setInterval AND rAF so useLoaderProgress is
    // deterministic. Without rAF in toFake, advanceTimersByTime would not
    // progress the loader.
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    installMatchMedia(false);
  });

  afterEach(() => {
    // Unmount under the same fake-timer regime that scheduled rAF/intervals,
    // so cleanup callbacks call the mocked cancelAnimationFrame rather than
    // the real one (codex round 3 review).
    cleanup();
    vi.useRealTimers();
  });

  it("initial render: progressbar exists, Begin absent", () => {
    render(<IntroScreen onComplete={vi.fn()} loaderDurationMs={1000} />);
    expect(screen.queryByRole("progressbar")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /begin/i })).toBeNull();
  });

  it("after loader duration: progress reaches 100, Begin appears and receives focus", () => {
    render(<IntroScreen onComplete={vi.fn()} loaderDurationMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    const progressbar = screen.getByRole("progressbar");
    expect(progressbar.getAttribute("aria-valuenow")).toBe("100");
    const beginButton = screen.getByRole("button", { name: /begin/i });
    expect(beginButton).not.toBeNull();
    // Without auto-dismiss this is the only exit; focus must land on Begin
    // so keyboard users can press Enter/Space immediately (codex round 3).
    expect(document.activeElement).toBe(beginButton);
  });

  it("click Begin: onComplete called exactly once", () => {
    const onComplete = vi.fn();
    render(<IntroScreen onComplete={onComplete} loaderDurationMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("rapid double-click on Begin: onComplete still fires only once", () => {
    // Codex round 6 hardening — without the completedRef guard a fast
    // user could fire onComplete twice. App.tsx is idempotent today, but
    // Begin is the only exit and may later gain side effects.
    const onComplete = vi.fn();
    render(<IntroScreen onComplete={onComplete} loaderDurationMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    const beginButton = screen.getByRole("button", { name: /begin/i });
    fireEvent.click(beginButton);
    fireEvent.click(beginButton);
    fireEvent.click(beginButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("prefers-reduced-motion: Begin visible immediately, still requires click", () => {
    installMatchMedia(true);
    const onComplete = vi.fn();
    render(<IntroScreen onComplete={onComplete} loaderDurationMs={5000} />);
    expect(screen.queryByRole("button", { name: /begin/i })).not.toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("unmount before completion: no onComplete call, no late progress", () => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <IntroScreen onComplete={onComplete} loaderDurationMs={5000} />
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
