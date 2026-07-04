/**
 * ThemeToggle — the Robinhood-mode switch on the welcome stage's backed-by
 * strip. Pins the a11y + interaction contract Codex asked for: a real
 * `role="switch"` with `aria-checked` tracking the persisted theme, native
 * keyboard operability (it's a `<button>`, so the platform activates it on
 * Space/Enter), a visible focus ring that re-tints per theme, and the
 * pointer-events restoration that lets it live inside the otherwise
 * click-transparent bottom band.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../ThemeToggle.js";
import { useUiStore } from "../../../stores/uiStore.js";

afterEach(() => {
  useUiStore.setState({ theme: "vex" });
});

describe("ThemeToggle", () => {
  it("is an accessible switch, OFF in the cobalt default", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("is keyboard-focusable with a visible, theme-tinted focus ring", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    // Native <button> → tab-reachable; prove it can hold focus.
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    // The focus ring resolves to --vex-accent, which flips cobalt→lime with the
    // theme, so the SAME class stays visible on ink in both modes.
    expect(toggle.className).toContain(
      "focus-visible:ring-[var(--vex-accent)]",
    );
    expect(toggle.className).toContain("focus-visible:ring-2");
  });

  it("clicking flips the persisted theme and updates aria-checked", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    // Click is what Space/Enter produce on a native button.
    fireEvent.click(toggle);
    expect(useUiStore.getState().theme).toBe("robinhood");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(useUiStore.getState().theme).toBe("vex");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("renders ON with the same focus ring when the store is in robinhood mode", () => {
    useUiStore.setState({ theme: "robinhood" });
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: /Robinhood mode/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    // Focus visibility does not depend on the theme (token-driven ring).
    expect(toggle.className).toContain(
      "focus-visible:ring-[var(--vex-accent)]",
    );
    // Restores pointer-events on itself inside the pointer-events-none band.
    expect(toggle.className).toContain("pointer-events-auto");
  });
});
