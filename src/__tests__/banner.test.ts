import { describe, it, expect, beforeEach, vi } from "vitest";

const mockIsHeadless = vi.fn(() => false);
const mockWriteStderr = vi.fn((_: string) => {});

vi.mock("../utils/output.js", () => ({
  isHeadless: () => mockIsHeadless(),
  writeStderr: (text: string) => mockWriteStderr(text),
}));

const { renderBatBanner, BANNER_LINES } = await import("../utils/banner.js");

describe("renderBatBanner", () => {
  beforeEach(() => {
    mockIsHeadless.mockReset();
    mockWriteStderr.mockReset();
  });

  it("returns false and prints nothing in headless mode", async () => {
    mockIsHeadless.mockReturnValue(true);

    const rendered = await renderBatBanner();

    expect(rendered).toBe(false);
    expect(mockWriteStderr).not.toHaveBeenCalled();
  });

  it("prints block-letter banner with framed subtitle", async () => {
    mockIsHeadless.mockReturnValue(false);

    const rendered = await renderBatBanner({ animated: false });

    expect(rendered).toBe(true);
    // Structure: empty + 6 banner lines + empty + frame top + frame content + frame bottom + trailing empty
    // = 1 + 6 + 1 + 3 + 1 = 12 calls
    expect(mockWriteStderr.mock.calls.length).toBeGreaterThanOrEqual(10);

    const outputs = mockWriteStderr.mock.calls.map((call) => call[0]);
    // First line is empty
    expect(outputs[0]).toBe("");
    // Banner lines contain block chars
    expect(outputs[1]).toContain("\u2588");
    // Contains EchoClaw branding in subtitle frame
    expect(outputs.some((o) => o.includes("0G Network"))).toBe(true);
    // Last line is empty
    expect(outputs.at(-1)).toBe("");
  });

  it("renders description when provided", async () => {
    mockIsHeadless.mockReturnValue(false);

    await renderBatBanner({ animated: false, subtitle: "Test Wizard", description: "A description." });

    const outputs = mockWriteStderr.mock.calls.map((call) => call[0]);
    expect(outputs.some((o) => o.includes("Test Wizard"))).toBe(true);
    expect(outputs.some((o) => o.includes("A description."))).toBe(true);
  });

  it("animated option is accepted but renders instantly", async () => {
    mockIsHeadless.mockReturnValue(false);

    const rendered = await renderBatBanner({ animated: true, delayMs: 1 });

    expect(rendered).toBe(true);
    expect(mockWriteStderr.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it("exports BANNER_LINES with 6 block-letter lines", () => {
    expect(BANNER_LINES).toHaveLength(6);
    expect(BANNER_LINES[0]).toContain("\u2588");
  });
});
