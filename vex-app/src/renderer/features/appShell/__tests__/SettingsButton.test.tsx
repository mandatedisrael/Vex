import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const mockOpenWizard = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: { openWizard: typeof mockOpenWizard }) => unknown,
  ) => selector({ openWizard: mockOpenWizard }),
}));

const { SettingsButton } = await import("../SettingsButton.js");

describe("SettingsButton", () => {
  it("opens the onboarding wizard in reconfigure mode", () => {
    mockOpenWizard.mockReset();
    const { getByRole } = render(<SettingsButton />);

    fireEvent.click(getByRole("button", { name: /Open settings/i }));

    expect(mockOpenWizard).toHaveBeenCalledWith("reconfigure");
  });
});
