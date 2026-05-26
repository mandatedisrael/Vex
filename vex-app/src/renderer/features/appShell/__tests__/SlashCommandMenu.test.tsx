/**
 * SlashCommandMenu render tests (stage 8-6a). Presentational only: open/closed
 * rendering, aria-selected highlight, and explicit (mousedown) selection.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { SlashCommandMenu } from "../SlashCommandMenu.js";
import { SLASH_COMMAND_CATALOG } from "../slash/catalog.js";

const items = SLASH_COMMAND_CATALOG.filter((e) =>
  e.template.startsWith("/re"),
); // retry, rewind, restore

function getOptionId(index: number): string {
  return `lb-option-${index}`;
}

function base() {
  return {
    items,
    activeIndex: 0,
    listboxId: "lb",
    getOptionId,
    onSelect: vi.fn(),
    onActivate: vi.fn(),
  };
}

describe("SlashCommandMenu (8-6a)", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      createElement(SlashCommandMenu, { ...base(), open: false }),
    );
    expect(container.querySelector('[data-vex-area="slash-menu"]')).toBeNull();
  });

  it("renders matching options with exactly one selected", () => {
    render(createElement(SlashCommandMenu, { ...base(), open: true, activeIndex: 1 }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(items.length);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
  });

  it("selecting an option (mousedown) calls onSelect with that entry", () => {
    const onSelect = vi.fn();
    render(
      createElement(SlashCommandMenu, { ...base(), open: true, onSelect }),
    );
    fireEvent.mouseDown(screen.getAllByRole("option")[0]!);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
