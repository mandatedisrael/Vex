/**
 * UnlockScreen — renderer test parity for the post-setup unlock flow.
 *
 * Mocks `window.vex.secrets.unlock` (skill §12) and the uiStore selector
 * surface. Uses `fireEvent` (no @testing-library/user-event installed in
 * vex-app, mirroring the KeystoreStep test). Validates:
 *  - PASSWORD_MIN_LENGTH client-side gate,
 *  - pending state during unlock,
 *  - error-message render on wallet.password_invalid,
 *  - password-field clear on success,
 *  - throttle-countdown render on secrets.unlock_throttled,
 *  - throttle window elapsing and re-enabling the form,
 *  - exact mock invocation arguments.
 *
 * Throttle tests intentionally use REAL timers — testing-library's `waitFor`
 * polls via `setTimeout`, which `vi.useFakeTimers` freezes. The component's
 * 1-second interval is short enough that the elapsed-window test still
 * finishes well inside the default 5s test deadline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Result } from "@shared/ipc/result.js";
import type { SecretsUnlockResult } from "@shared/schemas/secrets.js";

type UnlockReturnView = "wizard" | "appShell";

const mockUnlock =
  vi.fn<(input: { password: string }) => Promise<Result<SecretsUnlockResult>>>();
const mockSetCurrentView = vi.fn();
let mockUnlockReturnView: UnlockReturnView = "appShell";

vi.mock("../../../stores/uiStore.js", () => ({
  useUiStore: (
    selector: (s: {
      unlockReturnView: UnlockReturnView;
      setCurrentView: typeof mockSetCurrentView;
    }) => unknown,
  ) =>
    selector({
      unlockReturnView: mockUnlockReturnView,
      setCurrentView: mockSetCurrentView,
    }),
}));

const { UnlockScreen } = await import("../UnlockScreen.js");

function renderUnlockScreen(): ReturnType<typeof render> {
  return render(<UnlockScreen />);
}

beforeEach(() => {
  mockUnlock.mockReset();
  // Default to a generic "wrong password" Result so accidental calls don't
  // bubble out as Unhandled Rejection noise inside vitest. Each test that
  // exercises a specific branch overrides this with `mockResolvedValue`.
  mockUnlock.mockResolvedValue({
    ok: false,
    error: {
      code: "wallet.password_invalid",
      domain: "wallet",
      message: "Master password is incorrect.",
      retryable: true,
      userActionable: true,
      redacted: true,
    },
  });
  mockSetCurrentView.mockReset();
  mockUnlockReturnView = "appShell";
  Object.defineProperty(window, "vex", {
    configurable: true,
    value: {
      secrets: {
        unlock: mockUnlock,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "vex");
});

describe("UnlockScreen", () => {
  it("renders the password input and submit button", () => {
    const { getByLabelText, getByRole } = renderUnlockScreen();
    expect(getByLabelText(/Master password/i)).toBeTruthy();
    expect(getByRole("button", { name: /Unlock/i })).toBeTruthy();
  });

  it("rejects a password shorter than PASSWORD_MIN_LENGTH without calling unlock", async () => {
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "abc" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await view.findByText(/at least 8 characters/i);
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  it("calls window.vex.secrets.unlock with the entered password", async () => {
    mockUnlock.mockResolvedValue({ ok: true, data: { unlocked: true } });
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "valid-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith({ password: "valid-password-12" });
    });
  });

  it("shows a pending state while unlock is in-flight", async () => {
    // Never-resolving promise so the pending state is observable.
    mockUnlock.mockImplementation(
      () => new Promise<Result<SecretsUnlockResult>>(() => {}),
    );
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "valid-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await view.findByRole("button", { name: /Unlocking/i });
    const button = view.getByRole("button", { name: /Unlocking/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it("surfaces the server message on wrong-password without clearing the input", async () => {
    mockUnlock.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.password_invalid",
        domain: "wallet",
        message: "Master password is incorrect.",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "wrong-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await view.findByText(/Master password is incorrect/i);
    expect(input.value).toBe("wrong-password-12");
    expect(mockSetCurrentView).not.toHaveBeenCalled();
  });

  it("clears the password input and flips the view on a successful unlock", async () => {
    mockUnlockReturnView = "appShell";
    mockUnlock.mockResolvedValue({ ok: true, data: { unlocked: true } });
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "valid-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await waitFor(() => {
      expect(mockSetCurrentView).toHaveBeenCalledWith("appShell");
    });
    expect(input.value).toBe("");
  });

  it("renders a throttle countdown when unlock returns secrets.unlock_throttled", async () => {
    mockUnlock.mockResolvedValue({
      ok: false,
      error: {
        code: "secrets.unlock_throttled",
        domain: "wallet",
        message: "Too many attempts.",
        retryable: true,
        userActionable: true,
        redacted: true,
        retryAfterMs: 8000,
      },
    });
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "valid-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    // Wait for the throttle alert with the initial countdown to render. Real
    // timers stay engaged here so testing-library's `waitFor` can poll.
    const throttleNode = await waitFor(() => {
      const node = view.container.querySelector(
        '[data-vex-unlock-throttle="active"]',
      );
      if (node === null) throw new Error("throttle alert not rendered yet");
      return node;
    });
    expect(throttleNode.textContent).toMatch(/Too many attempts/);
    expect(throttleNode.textContent).toMatch(/8s/);

    const button = view.getByRole("button", { name: /Unlock/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(input.disabled).toBe(true);
  });

  it("re-enables the form once the throttle window elapses", async () => {
    mockUnlock.mockResolvedValue({
      ok: false,
      error: {
        code: "secrets.unlock_throttled",
        domain: "wallet",
        message: "Too many attempts.",
        retryable: true,
        userActionable: true,
        redacted: true,
        // 1.2s is short enough for a real-timer wait to stay fast without
        // racing the test runner's default 5s timeout.
        retryAfterMs: 1200,
      },
    });
    const view = renderUnlockScreen();
    const input = view.getByLabelText(/Master password/i) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "valid-password-12" } });
    fireEvent.click(view.getByRole("button", { name: /Unlock/i }));

    await waitFor(() => {
      const node = view.container.querySelector(
        '[data-vex-unlock-throttle="active"]',
      );
      if (node === null) throw new Error("throttle alert not rendered yet");
      return node;
    });

    // Real-timer wait: the component's 1000ms interval tick clears the throttle
    // state once `Date.now() >= retryAtMs`. Window plus tick + render margin.
    await waitFor(
      () => {
        expect(
          view.container.querySelector('[data-vex-unlock-throttle="active"]'),
        ).toBeNull();
      },
      { timeout: 4000 },
    );
    const button = view.getByRole("button", { name: /Unlock/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
