/**
 * ComposerQuickActions — the starter chips detached below the Signal Console.
 * Pins the redesign contract: each chip carries a small INTENT ICON, the 01–03
 * numbering is GONE (parallel starters, not an ordered sequence), and picking a
 * chip seeds the draft with its full prompt.
 *
 * HugeiconsIcon is stubbed to a span that surfaces the icon reference as a
 * `data-icon` attribute so the per-chip glyph is assertable in jsdom.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon }: { icon: unknown }) => (
    <span data-icon={String(icon)} />
  ),
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  FireIcon: "FireIcon",
  ChartLineData01Icon: "ChartLineData01Icon",
  PercentSquareIcon: "PercentSquareIcon",
}));

const { ComposerQuickActions } = await import("../ComposerQuickActions.js");

describe("ComposerQuickActions", () => {
  it("renders three intent chips with icons, no 01–03 numbering", () => {
    const { container } = render(<ComposerQuickActions onPick={() => {}} />);

    // Three starter chips, each a real focusable button.
    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(3);

    // Each intent icon is present (flame / chart / percent square).
    expect(container.querySelector('[data-icon="FireIcon"]')).not.toBeNull();
    expect(
      container.querySelector('[data-icon="ChartLineData01Icon"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-icon="PercentSquareIcon"]'),
    ).not.toBeNull();

    // The numbering was dropped — no 01/02/03 marks in the chip text.
    for (const n of ["01", "02", "03"]) {
      expect(screen.queryByText(n)).toBeNull();
    }
    // Sanity: the icon refs are attributes, never rendered text.
    expect(container.textContent).not.toMatch(/\b0[123]\b/);
  });

  it("seeds the draft with the chip's full prompt", () => {
    const onPick = vi.fn();
    render(<ComposerQuickActions onPick={onPick} />);
    fireEvent.click(
      screen.getByRole("button", { name: /hunt trending memecoins/i }),
    );
    expect(onPick).toHaveBeenCalledWith(
      "Hunt the trendiest memecoins right now — combine DexScreener trending narratives with X sentiment if my X account is connected, and propose a plan before any trade.",
    );
  });
});
