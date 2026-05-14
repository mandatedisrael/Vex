/**
 * ComposeBootstrap renderer tests — PR3 cancellation surface.
 *
 * Verifies:
 *  - Cancel button visible while compose-up is in flight, click calls
 *    the `cancel` handle returned by `composeUpAbortable`.
 *  - When the promise resolves to `internal.cancelled`, the
 *    "Startup cancelled." copy is shown + the Retry button appears.
 *  - Cancel button is NOT shown after success / error / cancel.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const mockCompose = vi.fn();
const mockCancel = vi.fn();
const mockOnComposeLog = vi.fn().mockReturnValue(() => {});
const mockSetCurrentView = vi.fn();

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (selector: (s: { setCurrentView: (v: string) => void }) => unknown) =>
    selector({ setCurrentView: mockSetCurrentView }),
}));

const { ComposeBootstrap } = await import("../ComposeBootstrap.js");

function arrangeBridge(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      docker: {
        composeUpAbortable: mockCompose,
        onComposeLog: mockOnComposeLog,
      },
    },
  });
}

beforeEach(() => {
  mockCompose.mockReset();
  mockCancel.mockReset();
  mockSetCurrentView.mockReset();
  arrangeBridge();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "vex");
});

describe("ComposeBootstrap — cancellation (PR3)", () => {
  it("shows the Cancel button while compose-up is in flight", () => {
    // Never-resolving promise simulates "still running".
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector("[data-vex-compose-cancel]");
    expect(button).not.toBeNull();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls the cancel handle when the Cancel button is clicked", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector(
      "[data-vex-compose-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(button);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it("transitions to a disabled Cancelling button immediately after click", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    const button = view.container.querySelector(
      "[data-vex-compose-cancel]",
    ) as HTMLButtonElement;
    fireEvent.click(button);
    const cancelling = view.container.querySelector(
      "[data-vex-compose-cancelling]",
    ) as HTMLButtonElement | null;
    expect(cancelling).not.toBeNull();
    expect(cancelling!.disabled).toBe(true);
  });

  it("renders 'Startup cancelled.' + Retry when the promise resolves to internal.cancelled", async () => {
    mockCompose.mockReturnValue({
      promise: Promise.resolve({
        ok: false,
        error: {
          code: "internal.cancelled",
          domain: "docker",
          message: "Operation cancelled.",
          retryable: true,
          userActionable: false,
          redacted: true,
          correlationId: "11111111-2222-4333-8444-555555555555",
        },
      }),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    await waitFor(() => {
      expect(view.container.textContent).toMatch(/Startup cancelled\./);
    });
    // Retry button is back; Cancel button is gone.
    const retry = Array.from(view.container.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry",
    );
    expect(retry).toBeTruthy();
    const cancel = view.container.querySelector("[data-vex-compose-cancel]");
    expect(cancel).toBeNull();
  });

  it("does NOT auto-cancel from effect cleanup (StrictMode race guard)", () => {
    mockCompose.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });
    const view = render(<ComposeBootstrap />);
    view.unmount();
    expect(mockCancel).not.toHaveBeenCalled();
  });
});
