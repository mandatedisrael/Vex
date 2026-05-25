import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

const mockSetAppShellView = vi.hoisted(() => vi.fn());
const mockMemoryEnabled = vi.hoisted(() => vi.fn());

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: { setAppShellView: typeof mockSetAppShellView }) => unknown,
  ) => selector({ setAppShellView: mockSetAppShellView }),
}));

vi.mock("../../../lib/api/capabilities.js", () => ({
  useMemoryFeatureEnabled: () => mockMemoryEnabled(),
}));

const { KnowledgeButton } = await import("../KnowledgeButton.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("KnowledgeButton", () => {
  it("renders nothing when the memory capability is disabled", () => {
    mockMemoryEnabled.mockReturnValue(false);
    const { queryByRole } = render(<KnowledgeButton />);
    expect(queryByRole("button", { name: /knowledge/i })).toBeNull();
  });

  it("opens the knowledge view when the memory capability is enabled", () => {
    mockMemoryEnabled.mockReturnValue(true);
    const { getByRole } = render(<KnowledgeButton />);
    fireEvent.click(getByRole("button", { name: /knowledge/i }));
    expect(mockSetAppShellView).toHaveBeenCalledWith("knowledge");
  });
});
