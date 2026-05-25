import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const mockSetAppShellView = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: { setAppShellView: typeof mockSetAppShellView }) => unknown,
  ) => selector({ setAppShellView: mockSetAppShellView }),
}));

const { SettingsButton } = await import("../SettingsButton.js");

describe("SettingsButton", () => {
  it("opens the in-app Settings screen", () => {
    mockSetAppShellView.mockReset();
    const { getByRole } = render(<SettingsButton />);

    fireEvent.click(getByRole("button", { name: /Open settings/i }));

    expect(mockSetAppShellView).toHaveBeenCalledWith("settings");
  });
});
