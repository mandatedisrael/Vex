/**
 * SidebarHomeSigil — the enlarged particle sigil that crowns the sessions rail
 * as the sole mark AND doubles as the "Back to welcome" control.
 *
 * Contract:
 *   1. on the welcome stage (no active session AND the default session view)
 *      it is an INERT mark — there is nowhere to navigate to, so no button;
 *   2. once a session is open it becomes a real "Back to welcome" button that
 *      clears the active session (returning the panel to the welcome stage);
 *   3. from a sub-view (library / memory) it also returns the panel to the
 *      session welcome view;
 *   4. it always renders the sigil (jsdom → the VexSigil <img> fallback), never
 *      a "VEX" wordmark.
 */

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SidebarHomeSigil } from "../SidebarHomeSigil.js";
import { useUiStore } from "../../../stores/uiStore.js";

afterEach(() => {
  useUiStore.setState({
    theme: "vex",
    activeSessionId: null,
    appShellView: "session",
  });
});

describe("SidebarHomeSigil", () => {
  it("is an inert sigil mark on the welcome stage (no Back-to-welcome button)", () => {
    useUiStore.setState({ activeSessionId: null, appShellView: "session" });
    const { container } = render(<SidebarHomeSigil sidebarOpen />);
    expect(
      screen.queryByRole("button", { name: /Back to welcome/i }),
    ).toBeNull();
    // Still carries the sigil (jsdom canvas → the <img> fallback), no wordmark.
    expect(container.querySelector("[data-vex-sigil]")).not.toBeNull();
    expect(screen.queryByText("VEX")).toBeNull();
  });

  it("becomes a Back-to-welcome button when a session is open and clears it", () => {
    useUiStore.setState({
      activeSessionId: "11111111-1111-4111-8111-111111111111",
      appShellView: "session",
    });
    render(<SidebarHomeSigil sidebarOpen />);
    const button = screen.getByRole("button", { name: /Back to welcome/i });
    fireEvent.click(button);
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().appShellView).toBe("session");
  });

  it("returns to the session welcome view from a sub-view (memory)", () => {
    useUiStore.setState({ activeSessionId: null, appShellView: "memory" });
    render(<SidebarHomeSigil sidebarOpen />);
    const button = screen.getByRole("button", { name: /Back to welcome/i });
    fireEvent.click(button);
    expect(useUiStore.getState().appShellView).toBe("session");
  });

  it("swaps the sigil source to the feather under the robinhood theme", () => {
    useUiStore.setState({ theme: "robinhood", activeSessionId: null });
    const { container } = render(<SidebarHomeSigil sidebarOpen />);
    const fallback = container.querySelector("[data-vex-sigil-fallback]");
    expect(fallback?.getAttribute("src")).toBe("/logo/robinhood-feather.png");
  });
});
