/**
 * Tests for the Vex splash screen. Verifies:
 *   1. Brand assets render with expected URLs.
 *   2. Min-duration timer fires onComplete exactly once.
 *   3. prefers-reduced-motion path skips animations but STILL holds the
 *      min duration before completion (no flash-and-disappear).
 *   4. StrictMode double-invoke does not call onComplete twice — codex
 *      YELLOW 5 (canonical fix is the effect cleanup, not a ref guard).
 *   5. Unmount before timer expiry cancels the pending callback.
 */

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Splash } from "../Splash.js";

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

describe("Splash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMatchMedia(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders all three brand assets at expected paths", () => {
    const onComplete = vi.fn();
    const { container } = render(<Splash onComplete={onComplete} />);
    const sources = Array.from(container.querySelectorAll("img")).map(
      (img) => img.getAttribute("src")
    );
    expect(sources).toContain("/logo.png");
    expect(sources).toContain("/logo_clean.png");
    expect(sources).toContain("/vex.jpg");
  });

  it("calls onComplete exactly once after minDurationMs", () => {
    const onComplete = vi.fn();
    render(<Splash onComplete={onComplete} minDurationMs={1500} />);

    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1499);
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("StrictMode double-mount does not double-fire onComplete", () => {
    const onComplete = vi.fn();
    render(
      <StrictMode>
        <Splash onComplete={onComplete} minDurationMs={1500} />
      </StrictMode>
    );

    vi.advanceTimersByTime(1500);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("prefers-reduced-motion still observes min duration", () => {
    installMatchMedia(true);
    const onComplete = vi.fn();
    render(<Splash onComplete={onComplete} minDurationMs={500} />);

    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("unmount before timer expiry cancels the pending onComplete", () => {
    const onComplete = vi.fn();
    const { unmount } = render(
      <Splash onComplete={onComplete} minDurationMs={1500} />
    );

    vi.advanceTimersByTime(800);
    unmount();
    vi.advanceTimersByTime(2000);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
