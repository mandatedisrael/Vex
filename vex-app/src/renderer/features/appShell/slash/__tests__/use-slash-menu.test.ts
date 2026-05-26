/**
 * useSlashMenu tests (stage 8-6a). Drives the open/active/dismiss + keyboard
 * logic without the composer's heavy data hooks. A real (detached) textarea
 * backs the ref so the post-select focus/caret layout effect runs in jsdom.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type KeyboardEvent } from "react";
import { useSlashMenu } from "../use-slash-menu.js";

function keyEvent(key: string): KeyboardEvent<HTMLTextAreaElement> {
  // Minimal stand-in: the hook only reads `key` and calls `preventDefault`.
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent<
    HTMLTextAreaElement
  >;
}

function setup(initialDraft: string) {
  const setDraft = vi.fn();
  const textareaRef = { current: document.createElement("textarea") };
  const view = renderHook(
    ({ draft }: { readonly draft: string }) =>
      useSlashMenu({ draft, setDraft, textareaRef }),
    { initialProps: { draft: initialDraft } },
  );
  return { ...view, setDraft };
}

describe("useSlashMenu (8-6a)", () => {
  it("is closed for a non-slash draft and open for a slash query with matches", () => {
    const { result, rerender } = setup("");
    expect(result.current.open).toBe(false);

    rerender({ draft: "/re" });
    expect(result.current.open).toBe(true);
    expect(result.current.items.map((e) => e.kind).sort()).toEqual(
      ["restore", "retry", "rewind"].sort(),
    );
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.activeOptionId).toBe(result.current.getOptionId(0));
  });

  it("ArrowDown/ArrowUp move the highlight and wrap", () => {
    const { result } = setup("/re"); // 3 items
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown")));
    expect(result.current.activeIndex).toBe(0); // wrapped 2 -> 0
    act(() => result.current.handleKeyDown(keyEvent("ArrowUp")));
    expect(result.current.activeIndex).toBe(2); // wrapped 0 -> 2
  });

  it("Enter selects the active item, inserting its template", () => {
    const { result, setDraft } = setup("/re");
    act(() => result.current.handleKeyDown(keyEvent("ArrowDown"))); // rewind at index 1
    const expected = result.current.items[1]!.template;
    act(() => result.current.handleKeyDown(keyEvent("Enter")));
    expect(setDraft).toHaveBeenCalledWith(expected);
  });

  it("suppresses reopen against the inserted value, but reopens on the next edit", () => {
    const { result, rerender } = setup("/re");
    const inserted = result.current.items[0]!.template; // "/retry"
    act(() => result.current.handleKeyDown(keyEvent("Enter")));
    // Simulate the controlled update the composer performs after select.
    rerender({ draft: inserted });
    expect(result.current.open).toBe(false);
    // Editing past the dismissed value reopens (here: deleting a char).
    rerender({ draft: inserted.slice(0, -1) });
    expect(result.current.open).toBe(true);
  });

  it("Escape dismisses until the draft changes", () => {
    const { result, rerender } = setup("/re");
    act(() => result.current.handleKeyDown(keyEvent("Escape")));
    rerender({ draft: "/re" });
    expect(result.current.open).toBe(false);
    rerender({ draft: "/res" });
    expect(result.current.open).toBe(true);
  });
});
