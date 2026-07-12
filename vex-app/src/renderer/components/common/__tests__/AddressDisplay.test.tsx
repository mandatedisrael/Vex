import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { AddressDisplay } = await import("../AddressDisplay.js");

const ADDRESS = "0x637d1234567890abcdef1234567890abcdef39C2";
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddressDisplay", () => {
  it("copies the full address and swaps the inline copy glyph for a checkmark", async () => {
    const view = render(
      <AddressDisplay
        address={ADDRESS}
        appearance="inline"
        copyLabel="Copy EVM wallet address"
        copiedLabel="Address copied"
      />,
    );

    const copy = screen.getByRole("button", {
      name: "Copy EVM wallet address",
    });
    expect(
      copy.querySelector('[data-vex-copy-glyph="copy"]'),
    ).not.toBeNull();

    fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
    const copied = await screen.findByRole("button", {
      name: "Address copied",
    });
    expect(
      copied.querySelector('[data-vex-copy-glyph="check"]'),
    ).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Address copied");
    expect(
      view.container.querySelector('[data-vex-address-copy="copied"]'),
    ).not.toBeNull();
  });

  it("uses the permissionless selection fallback before showing success", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard permission denied"));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    render(<AddressDisplay address={ADDRESS} appearance="inline" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));

    await screen.findByRole("button", { name: "Address copied" });
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("preserves the existing chip appearance by default", () => {
    render(<AddressDisplay address={ADDRESS} />);

    expect(screen.getByRole("button", { name: "Copy address" }).textContent).toBe(
      "copy",
    );
    expect(screen.getByText(`${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-4)}`)).toBeTruthy();
  });
});
