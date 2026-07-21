/**
 * SessionWelcomeHero — Grok-style logo-row contract (owner decree
 * 2026-07-21).
 *
 * Pins the pieces other suites and the design system depend on:
 *   1. the H1 "What should I execute?" is DELETED — no heading of any level
 *      renders on the stage (shell-sidebar / welcome-create assert the same
 *      absence through the full AppShell; this is the close-range pin), and
 *      the retired barcode flicker class is gone with it;
 *   2. the crown is ONE centered logo row — the VexSigil mark beside the
 *      PREVIEW · v{version} wordmark badge (Grok's [icon + wordmark]
 *      grammar) — riding the base .vex-rise slot as one unit;
 *   3. the badge contract: White House face (Instrument Sans via
 *      font-sans), SOLID base text wearing the `.vex-preview-shimmer`
 *      overlay through `data-shimmer-text` (the delta-shimmer idiom — the
 *      base text is never background-clipped), the honest build-stage
 *      tooltip via a plain `title`, a static non-interactive SPAN;
 *   4. the hero's ONLY imagery is the sigil (jsdom: the canvas falls back
 *      to the plain monogram <img> INSIDE [data-vex-sigil]) plus the bottom
 *      band's partner mark;
 *   5. the bottom band is unchanged: ONLY the centered BACKED BY hallmark,
 *      closing the rise choreography at d4;
 *   6. retired compositions stay dead: the H1, the rotating tagline quips,
 *      the eyebrow status line, the old hairline PREVIEW pill's border
 *      chrome, the integrations rail, and the theme switch.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionWelcomeHero } from "../SessionWelcomeHero.js";

const PREVIEW_LABEL = "PREVIEW · v0.0.0-test";

/** The five retired rotator quips — must never render again. */
const RETIRED_QUIPS = [
  "Signed. Sealed. Executed.",
  "Your rules. My moves.",
  "Propose. Enforce. Prove.",
  "The desk is open.",
  "VEX is listening.",
] as const;

describe("SessionWelcomeHero", () => {
  it("deletes the H1 — no heading renders on the stage at all", () => {
    render(<SessionWelcomeHero />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(/What should I execute/i)).toBeNull();
  });

  it("renders the logo row: sigil + PREVIEW wordmark side by side as one rising unit", () => {
    const { container } = render(<SessionWelcomeHero />);
    const sigil = container.querySelector("[data-vex-sigil]");
    expect(sigil).not.toBeNull();
    const badge = screen.getByText(PREVIEW_LABEL);
    // One row: the mark and the wordmark share the same flex parent.
    const row = sigil?.parentElement ?? null;
    expect(row).not.toBeNull();
    expect(badge.parentElement).toBe(row);
    expect(row?.classList.contains("items-center")).toBe(true);
    // The row takes the base .vex-rise slot as ONE unit (no delay modifier);
    // its children carry no rise classes of their own.
    expect(row?.classList.contains("vex-rise")).toBe(true);
    expect(row?.classList.contains("vex-rise-d1")).toBe(false);
    expect(badge.classList.contains("vex-rise")).toBe(false);
    expect(sigil?.classList.contains("vex-rise")).toBe(false);
  });

  it("badge: Instrument Sans wordmark with the shimmer overlay, solid base text, honest tooltip", () => {
    render(<SessionWelcomeHero />);
    const badge = screen.getByText(PREVIEW_LABEL);
    expect(badge.textContent).toBe(PREVIEW_LABEL);
    // Shimmer contract (the .vex-delta-shimmer idiom): the overlay
    // duplicates the SOLID text via data-shimmer-text — the class must
    // pair with the attribute or the ::after band has nothing to clip to.
    expect(badge.classList.contains("vex-preview-shimmer")).toBe(true);
    expect(badge.getAttribute("data-shimmer-text")).toBe(PREVIEW_LABEL);
    // White House face: Instrument Sans, not the serif and not the mono.
    expect(badge.classList.contains("font-sans")).toBe(true);
    expect(badge.classList.contains("font-serif")).toBe(false);
    expect(badge.classList.contains("font-mono")).toBe(false);
    // Honest build-stage disclosure carried over from the retired pill.
    expect(badge.getAttribute("title")).toBe(
      "Preview build (v0.0.0-test). Vex is pre-1.0 and evolving. " +
        "Self-custodial — you control your keys and every action. " +
        "Verify before moving funds. Not financial advice.",
    );
    expect(badge.getAttribute("aria-label")).toBe(PREVIEW_LABEL);
    // Non-interactive: a static disclosure wordmark, not a button/link, and
    // the old hairline pill chrome is gone (no border classes).
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).not.toContain("border");
  });

  it("carries the sigil crown (decorative, with the jsdom monogram fallback) plus the partner mark", () => {
    const { container } = render(<SessionWelcomeHero />);
    const sigil = container.querySelector("[data-vex-sigil]");
    expect(sigil).not.toBeNull();
    // Decorative contract on the mark.
    expect(sigil?.getAttribute("aria-hidden")).toBe("true");
    expect(sigil?.className).toContain("pointer-events-none");
    // jsdom: the sigil's canvas 2D is unavailable → its <img> fallback lives
    // INSIDE the sigil box (the VEX monogram).
    const sigilImg = sigil?.querySelector("[data-vex-sigil-fallback]");
    expect(sigilImg?.getAttribute("src")).toBe("/logo_clean.png");
    // The only other imagery on the stage is the bottom band's partner mark.
    const backing = Array.from(container.querySelectorAll("img")).filter(
      (img) =>
        sigil?.contains(img) === false && (img.getAttribute("alt") ?? "") !== "",
    );
    expect(backing.map((img) => img.getAttribute("alt"))).toEqual(["Virtuals"]);
  });

  it("keeps the BACKED BY bottom band unchanged, closing the rise at d4", () => {
    render(<SessionWelcomeHero />);
    expect(screen.getByText("Backed by")).not.toBeNull();
    expect(screen.getByAltText("Virtuals")).not.toBeNull();
    // The band rises LAST (d4) as one unit.
    const bottomRow = screen.getByText("Backed by").closest(".vex-rise");
    expect(bottomRow).not.toBeNull();
    expect(bottomRow?.classList.contains("vex-rise-d4")).toBe(true);
    // The retired Robinhood mark and mode switch stay dead.
    expect(screen.queryByAltText("Robinhood")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("retired compositions stay dead: quips, eyebrow, barcode, integrations rail", () => {
    const { container } = render(<SessionWelcomeHero />);
    // The rotating tagline quips (retired 2026-07-21) never render.
    for (const quip of RETIRED_QUIPS) {
      expect(screen.queryByText(quip)).toBeNull();
    }
    // No eyebrow status line, no barcode flicker (deleted with the H1).
    expect(container.querySelector(".vex-eyebrow")).toBeNull();
    expect(container.querySelector(".vex-title-barcode")).toBeNull();
    // The "Executes through" integrations rail stays retired.
    expect(screen.queryByText(/Executes through/i)).toBeNull();
    // The phase-5 img-in-text quips (the inline monogram mechanism).
    expect(screen.queryByAltText("Vex")).toBeNull();
  });
});
