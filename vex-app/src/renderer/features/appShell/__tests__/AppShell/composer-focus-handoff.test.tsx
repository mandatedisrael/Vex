/**
 * Focus handoff BACK to the composer after leaving Hypervexing
 * (fix/hypervexing-exit-focus, item b). Same isolated `lib/api` mocking
 * harness as composer-console.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useUiStore } from "../../../../stores/uiStore.js";

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Add01Icon: "Add01Icon",
  CheckmarkCircle02Icon: "CheckmarkCircle02Icon",
  Download01Icon: "Download01Icon",
  ArrowDown01Icon: "ArrowDown01Icon",
  ArrowUp01Icon: "ArrowUp01Icon",
  // Welcome Portfolio tab (BookPanel's welcome stage): handle + card icons.
  ArrowRight01Icon: "ArrowRight01Icon",
  Wallet01Icon: "Wallet01Icon",
  MapPinIcon: "MapPinIcon",
  AiBrain05Icon: "AiBrain05Icon",
  StopCircleIcon: "StopCircleIcon",
  FireIcon: "FireIcon",
  ChartLineData01Icon: "ChartLineData01Icon",
  PercentSquareIcon: "PercentSquareIcon",
}));

const mockSubmitChat = {
  isPending: false as boolean,
  mutateAsync: vi.fn(),
  stop: vi.fn(),
};
vi.mock("../../../../lib/api/chat.js", () => ({
  useSubmitChat: () => mockSubmitChat,
}));
vi.mock("../../../../lib/api/messages.js", () => ({
  useTranscriptInfinite: () => ({ data: undefined, isSuccess: false }),
  flattenTranscriptPages: () => [],
}));
vi.mock("../../../../lib/api/runtime.js", () => ({
  useRuntimeState: () => ({ data: { ok: true, data: { status: null } } }),
}));
vi.mock("../../../../lib/api/models.js", () => ({
  useAvailableModels: () => ({ data: undefined }),
}));

const { SessionComposer } = await import("../../SessionComposer.js");

const SESSION = "00000000-0000-4000-8000-00000000cc02";

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({
    createSessionInitialTurn: null,
  });
});

describe("SessionComposer focusRequest", () => {
  it("focuses the draft field and reports the request handled when focusRequest turns true", () => {
    const onFocusRequestHandled = vi.fn();
    const { rerender } = render(
      <SessionComposer
        activeSession={null}
        activeSessionId={SESSION}
        focusRequest={false}
        onFocusRequestHandled={onFocusRequestHandled}
      />,
    );
    const draft = screen.getByLabelText("Session draft");
    expect(document.activeElement).not.toBe(draft);
    expect(onFocusRequestHandled).not.toHaveBeenCalled();

    rerender(
      <SessionComposer
        activeSession={null}
        activeSessionId={SESSION}
        focusRequest
        onFocusRequestHandled={onFocusRequestHandled}
      />,
    );
    expect(document.activeElement).toBe(draft);
    expect(onFocusRequestHandled).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus or call the handler when focusRequest is absent", () => {
    const onFocusRequestHandled = vi.fn();
    render(
      <SessionComposer
        activeSession={null}
        activeSessionId={SESSION}
        onFocusRequestHandled={onFocusRequestHandled}
      />,
    );
    const draft = screen.getByLabelText("Session draft");
    fireEvent.blur(draft);
    expect(document.activeElement).not.toBe(draft);
    expect(onFocusRequestHandled).not.toHaveBeenCalled();
  });
});
