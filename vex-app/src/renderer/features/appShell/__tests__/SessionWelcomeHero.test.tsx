/**
 * SessionWelcomeHero — phase-6 "Vex Sigil" centered-hero contract.
 *
 * Pins the pieces other suites and the design system depend on:
 *   1. the H1 "What should I execute?" stays a REAL heading (shell-sidebar
 *      asserts it through the full AppShell; this is the close-range pin)
 *      and wears the landing barcode flicker (.vex-title-barcode);
 *   2. the stage carries the minimal centered grammar ONLY — the VexSigil
 *      particle monogram as the crown, the mono status line (the
 *      TaglineRotator: STANDALONE mono-uppercase brand quips, no inline
 *      imagery) + the H1 above the composer, and the bottom row copy
 *      (LOCAL-FIRST CAPITAL RUNTIME / YOU SIGN EVERY ACTION). The retired
 *      compositions stay dead: the phase-3 register stack, the phase-4
 *      combined trust caption, the phase-5 static "Register open" eyebrow
 *      AND the phase-5 img-in-text quips (the inline monogram mechanism);
 *   3. the hero's ONLY imagery is the sigil: in jsdom the VexSigil canvas
 *      falls back to the plain monogram <img> INSIDE [data-vex-sigil]; the
 *      tagline line itself carries NO <img> anymore;
 *   4. the one-shot rise choreography, shifted one step for the crown:
 *      sigil (.vex-rise) → status (d1) → H1 (d2) → bottom row (d4). The
 *      instrument (d2) and chips (d3) are staggered by SessionPanel /
 *      ComposerQuickActions, outside this component;
 *   5. the rotator contract: exactly five user-pinned quips advancing every
 *      ~4.2s replaying .vex-rise on a fresh keyed span, pausing while
 *      document.hidden, rendering the first quip statically under
 *      prefers-reduced-motion, and keeping screen readers out of the
 *      rotation (aria-hidden line + stable sr-only copy).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SessionWelcomeHero } from "../SessionWelcomeHero.js";
import { useUiStore } from "../../../stores/uiStore.js";

const ROTATE_MS = 4200;

const QUIPS = [
  "Signed. Sealed. Executed.",
  "Your rules. My moves.",
  "Propose. Enforce. Prove.",
  "The desk is open.",
  "VEX is listening.",
] as const;

type MatchMediaListener = (event: MediaQueryListEvent) => void;

/** Minimal matchMedia stub — mirrors IntroScreen.test.tsx. */
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
        removeEventListener: (_evt: string, _cb: MatchMediaListener) =>
          undefined,
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

describe("SessionWelcomeHero", () => {
  // The sigil crown + Robinhood-mode toggle read uiStore.theme; return the
  // global store to the cobalt default after every test.
  afterEach(() => {
    useUiStore.setState({ theme: "vex" });
  });

  it("keeps the pinned H1 as a real heading wearing the landing barcode flicker", () => {
    render(<SessionWelcomeHero />);
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: /What should I execute\?/i,
    });
    expect(h1.classList.contains("vex-title-barcode")).toBe(true);
  });

  it("renders ONLY the sigil + status line + H1 above the composer, plus the bottom row copy", () => {
    const { container } = render(<SessionWelcomeHero />);
    // The sigil crowns the hero column.
    expect(container.querySelector("[data-vex-sigil]")).not.toBeNull();
    // The rotator opens on the first user-pinned quip.
    expect(screen.getByText(QUIPS[0])).not.toBeNull();
    expect(screen.getByText("LOCAL-FIRST CAPITAL RUNTIME")).not.toBeNull();
    expect(screen.getByText("YOU SIGN EVERY ACTION")).not.toBeNull();
    // Retired compositions stay dead — the phase-3 register stack…
    expect(screen.queryByText("Peace of mind")).toBeNull();
    expect(
      screen.queryByText("Your rules hold, even when you look away."),
    ).toBeNull();
    expect(screen.queryByText("Policy before signing")).toBeNull();
    // …the phase-4 combined trust caption (split across the row)…
    expect(
      screen.queryByText("Local-first · You sign every action"),
    ).toBeNull();
    // …the phase-5 static eyebrow the rotator replaced…
    expect(screen.queryByText("Register open")).toBeNull();
    // …and the phase-5 img-in-text quips (the inline monogram mechanism).
    expect(screen.queryByText(/Time for/i)).toBeNull();
    expect(screen.queryByAltText("Vex")).toBeNull();
  });

  it("carries the sigil crown plus the two backed-by partner marks; the tagline line has NO inline img", () => {
    const { container } = render(<SessionWelcomeHero />);
    const sigil = container.querySelector("[data-vex-sigil]");
    expect(sigil).not.toBeNull();
    // Decorative contract on the mark.
    expect(sigil?.getAttribute("aria-hidden")).toBe("true");
    expect(sigil?.className).toContain("pointer-events-none");
    // jsdom: the sigil's canvas 2D is unavailable → its <img> fallback lives
    // INSIDE the sigil box (default theme = the VEX monogram).
    const sigilImg = sigil?.querySelector("[data-vex-sigil-fallback]");
    expect(sigilImg?.getAttribute("src")).toBe("/logo_clean.png");
    // The backed-by partner strip is present outside the sigil. (The welcome
    // integrations rail added by the UI pass contributes additional decorative
    // empty-alt icons — the pin asserts the two NAMED partner marks exist,
    // not img exclusivity.)
    const backing = Array.from(container.querySelectorAll("img")).filter(
      (img) => sigil?.contains(img) === false && (img.getAttribute("alt") ?? "") !== "",
    );
    expect(backing.map((img) => img.getAttribute("alt")).sort()).toEqual([
      "Robinhood",
      "Virtuals",
    ]);
    // The status line is standalone text — no img-in-text.
    const eyebrow = container.querySelector(".vex-eyebrow");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow?.querySelector("img")).toBeNull();
  });

  it("renders the BACKED BY strip with both partner marks and the Robinhood-mode switch", () => {
    render(<SessionWelcomeHero />);
    expect(screen.getByText("Backed by")).not.toBeNull();
    expect(screen.getByAltText("Virtuals")).not.toBeNull();
    expect(screen.getByAltText("Robinhood")).not.toBeNull();
    // The toggle is a real, keyboard-focusable switch, OFF in the cobalt default.
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // The bottom band is click-transparent EXCEPT the toggle, which restores
    // pointer-events on itself.
    expect(toggle.className).toContain("pointer-events-auto");
  });

  it("the toggle flips the persisted theme and the switch reflects it", () => {
    render(<SessionWelcomeHero />);
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    fireEvent.click(toggle);
    expect(useUiStore.getState().theme).toBe("robinhood");
    expect(
      screen.getByRole("switch", { name: /Robinhood mode/i }).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("robinhood mode swaps the sigil crown to the feather source", () => {
    useUiStore.setState({ theme: "robinhood" });
    const { container } = render(<SessionWelcomeHero />);
    const sigil = container.querySelector("[data-vex-sigil]");
    // jsdom fallback → the sigil <img> now samples the feather, not the monogram.
    const sigilImg = sigil?.querySelector("[data-vex-sigil-fallback]");
    expect(sigilImg?.getAttribute("src")).toBe("/logo/robinhood-feather.png");
  });

  it("staggers the one-shot rise choreography: sigil → status (d1) → H1 (d2) → bottom row (d4)", () => {
    const { container } = render(<SessionWelcomeHero />);
    // The sigil takes the base .vex-rise slot (no delay modifier).
    const sigil = container.querySelector("[data-vex-sigil]");
    expect(sigil?.classList.contains("vex-rise")).toBe(true);
    expect(sigil?.classList.contains("vex-rise-d1")).toBe(false);
    // The status line shifts one step down.
    const status = container.querySelector(".vex-eyebrow");
    expect(status).not.toBeNull();
    expect(status?.classList.contains("vex-rise")).toBe(true);
    expect(status?.classList.contains("vex-rise-d1")).toBe(true);
    const h1 = screen.getByRole("heading", {
      level: 1,
      name: /What should I execute\?/i,
    });
    expect(h1.classList.contains("vex-rise")).toBe(true);
    expect(h1.classList.contains("vex-rise-d2")).toBe(true);
    // The bottom row rises LAST (d4) as one unit.
    const bottomRow = screen
      .getByText("YOU SIGN EVERY ACTION")
      .closest(".vex-rise");
    expect(bottomRow).not.toBeNull();
    expect(bottomRow?.classList.contains("vex-rise-d4")).toBe(true);
  });

  describe("tagline rotator", () => {
    beforeEach(() => {
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
    });

    afterEach(() => {
      // Unmount under the same fake-timer regime that scheduled the
      // interval, so cleanup calls the mocked clearInterval (mirrors
      // IntroScreen.test.tsx); then drop the environment shims.
      cleanup();
      vi.useRealTimers();
      removeMatchMedia();
      restoreDocumentHidden();
    });

    it("cycles the five user-pinned quips in order on fresh keyed .vex-rise spans", () => {
      render(<SessionWelcomeHero />);
      const first = screen.getByText(QUIPS[0]);
      expect(first.classList.contains("vex-rise")).toBe(true);
      // Walk the full cycle: each swap unmounts the previous quip and
      // mounts the next on a fresh keyed span replaying the one-shot rise.
      let previous: string = QUIPS[0];
      for (const quip of QUIPS.slice(1)) {
        act(() => {
          vi.advanceTimersByTime(ROTATE_MS);
        });
        expect(screen.queryByText(previous)).toBeNull();
        const current = screen.getByText(quip);
        expect(current.classList.contains("vex-rise")).toBe(true);
        previous = quip;
      }
      // …and wraps back around to the first.
      act(() => {
        vi.advanceTimersByTime(ROTATE_MS);
      });
      expect(screen.getByText(QUIPS[0])).not.toBeNull();
    });

    it("pauses rotation while document.hidden and resumes on visibility", () => {
      render(<SessionWelcomeHero />);
      setDocumentHidden(true);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => {
        vi.advanceTimersByTime(3 * ROTATE_MS);
      });
      // Hidden → no swaps happened.
      expect(screen.getByText(QUIPS[0])).not.toBeNull();
      setDocumentHidden(false);
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      act(() => {
        vi.advanceTimersByTime(ROTATE_MS);
      });
      expect(screen.getByText(QUIPS[1])).not.toBeNull();
    });

    it("prefers-reduced-motion: no interval — the first quip renders statically", () => {
      installMatchMedia(true);
      render(<SessionWelcomeHero />);
      act(() => {
        vi.advanceTimersByTime(3 * ROTATE_MS);
      });
      expect(screen.getByText(QUIPS[0])).not.toBeNull();
      expect(screen.queryByText(QUIPS[1])).toBeNull();
    });

    it("keeps screen readers out of the rotation: aria-hidden line + stable sr-only copy", () => {
      render(<SessionWelcomeHero />);
      expect(screen.getByText(QUIPS[0]).getAttribute("aria-hidden")).toBe(
        "true",
      );
      const stable = screen.getByText("Vex is ready.");
      expect(stable.classList.contains("sr-only")).toBe(true);
    });
  });
});
